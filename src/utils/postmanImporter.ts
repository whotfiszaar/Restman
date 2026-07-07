import { db, type Collection, type Folder, type RequestItem } from "../db/db";

interface PostmanImportResult {
  success: boolean;
  collectionName: string;
  requestsCount: number;
  foldersCount: number;
  error?: string;
}

/**
 * Helper to convert double curly brace variable format {{var}} to standard ${var} format.
 */
function convertPostmanVariables(text: string): string {
  if (!text) return "";
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, "${$1}");
}

/**
 * Parses and imports a Postman collection (v2 or v2.1) into the local IndexedDB.
 * Wrapped in an atomic transaction to prevent database pollution if a failure occurs.
 */
export async function importPostmanCollection(jsonString: string): Promise<PostmanImportResult> {
  try {
    const data = JSON.parse(jsonString);

    // Validate Postman Collection format
    const info = data.info;
    if (!info || !info.name || (!info.schema?.includes("collection.json") && !data.item)) {
      throw new Error("Invalid format. Missing collection info/schema.");
    }

    const collectionId = `coll-pm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const collectionName = info.name;

    // Create the Collection object
    const newCollection: Collection = {
      id: collectionId,
      name: collectionName,
      description: info.description || "Imported from Postman Collection",
      createdAt: Date.now(),
    };

    let requestsCount = 0;
    let foldersCount = 0;

    // Use Dexie atomic transaction
    await db.transaction("rw", [db.collections, db.folders, db.requests], async () => {
      // Create the collection inside transaction
      await db.collections.add(newCollection);

      // Recursive helper to traverse Postman items (depth limit enforced to prevent stack overflow)
      async function traverseItems(items: any[], parentFolderId: string | null, depth = 0) {
        if (depth > 10) {
          console.warn("Postman Import: Max folder nesting depth (10) reached. Stopping recursion.");
          return;
        }

        for (const item of items) {
          if (!item) continue;

          const isFolder = !!item.item; // If it has items, it is a folder

          if (isFolder) {
            const folderId = `folder-pm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            const newFolder: Folder = {
              id: folderId,
              collectionId,
              parentFolderId,
              name: item.name || "Untitled Folder",
              createdAt: Date.now() + foldersCount, // micro offset to maintain insertion order
            };

            await db.folders.add(newFolder);
            foldersCount++;

            // Recursively traverse items in folder
            if (Array.isArray(item.item)) {
              await traverseItems(item.item, folderId, depth + 1);
            }
          } else {
            // It's a request!
            const request = item.request;
            if (!request) continue;

            // Parse URL
            let urlStr = "";
            if (typeof request.url === "string") {
              urlStr = request.url;
            } else if (request.url && typeof request.url === "object") {
              urlStr = request.url.raw || "";
            }
            // Convert variable syntax
            urlStr = convertPostmanVariables(urlStr);

            // Auto-decode percent encoding for imported URLs
            try {
              let decoded = urlStr;
              for (let i = 0; i < 3; i++) {
                const nextDecoded = decodeURIComponent(decoded);
                if (nextDecoded === decoded) break;
                decoded = nextDecoded;
              }
              urlStr = decoded;
            } catch (err) {
              // fallback
            }

            // Parse HTTP Method
            const method = (request.method || "GET").toUpperCase();

            // Parse Headers
            const headers: RequestItem["headers"] = [];
            if (Array.isArray(request.header)) {
              request.header.forEach((h: any, idx: number) => {
                if (!h.key) return;
                headers.push({
                  id: `header-pm-${idx}-${Math.random().toString(36).substring(2, 6)}`,
                  key: h.key,
                  value: convertPostmanVariables(h.value || ""),
                  enabled: h.disabled !== true,
                  description: h.description,
                });
              });
            }

            // Parse URL Query Params
            const params: RequestItem["params"] = [];
            if (request.url && Array.isArray(request.url.query)) {
              request.url.query.forEach((q: any, idx: number) => {
                if (!q.key) return;
                params.push({
                  id: `param-pm-${idx}-${Math.random().toString(36).substring(2, 6)}`,
                  key: q.key,
                  value: convertPostmanVariables(q.value || ""),
                  enabled: q.disabled !== true,
                  description: q.description,
                });
              });
            }

            // Parse Auth
            let authType: RequestItem["auth"]["type"] = "none";
            let bearerToken = "";
            let basicUsername = "";
            let basicPassword = "";
            let apiKeyKey = "";
            let apiKeyValue = "";
            let apiKeyAddTo: "header" | "query" = "header";

            if (request.auth) {
              const type = request.auth.type;
              if (type === "bearer" && Array.isArray(request.auth.bearer)) {
                authType = "bearer";
                const tokenObj = request.auth.bearer.find((b: any) => b.key === "token");
                bearerToken = tokenObj ? convertPostmanVariables(tokenObj.value || "") : "";
              } else if (type === "basic" && Array.isArray(request.auth.basic)) {
                authType = "basic";
                const userObj = request.auth.basic.find((b: any) => b.key === "username");
                const passObj = request.auth.basic.find((b: any) => b.key === "password");
                basicUsername = userObj ? convertPostmanVariables(userObj.value || "") : "";
                basicPassword = passObj ? convertPostmanVariables(passObj.value || "") : "";
              } else if (type === "apikey" && Array.isArray(request.auth.apikey)) {
                authType = "apiKey";
                const keyObj = request.auth.apikey.find((b: any) => b.key === "key");
                const valObj = request.auth.apikey.find((b: any) => b.key === "value");
                const inObj = request.auth.apikey.find((b: any) => b.key === "in");
                apiKeyKey = keyObj ? convertPostmanVariables(keyObj.value || "api_key") : "api_key";
                apiKeyValue = valObj ? convertPostmanVariables(valObj.value || "") : "";
                apiKeyAddTo = inObj && inObj.value === "query" ? "query" : "header";
              }
            }

            // Parse Body
            let bodyType: RequestItem["body"]["type"] = "none";
            let bodyContent = "";
            const formParams: RequestItem["body"]["formParams"] = [];

            if (request.body) {
              const mode = request.body.mode;
              if (mode === "raw") {
                bodyType = "json"; // Default fallback
                bodyContent = convertPostmanVariables(request.body.raw || "");

                // Try to detect content-type to see if it is JSON, XML or plain text
                const options = request.body.options?.raw;
                if (options?.language === "xml") {
                  bodyType = "xml";
                } else if (options?.language === "json") {
                  bodyType = "json";
                } else if (bodyContent.trim().startsWith("<")) {
                  bodyType = "xml";
                } else if (bodyContent.trim().startsWith("{") || bodyContent.trim().startsWith("[")) {
                  bodyType = "json";
                } else {
                  bodyType = "raw";
                }
              } else if (mode === "formdata" && Array.isArray(request.body.formdata)) {
                bodyType = "form-data";
                request.body.formdata.forEach((f: any, idx: number) => {
                  if (!f.key) return;
                  formParams.push({
                    id: `fp-pm-${idx}-${Math.random().toString(36).substring(2, 6)}`,
                    key: f.key,
                    value: convertPostmanVariables(f.value || ""),
                    enabled: f.disabled !== true,
                    type: f.type === "file" ? "file" : "text",
                  });
                });
              } else if (mode === "urlencoded" && Array.isArray(request.body.urlencoded)) {
                bodyType = "urlencoded";
                request.body.urlencoded.forEach((f: any, idx: number) => {
                  if (!f.key) return;
                  formParams.push({
                    id: `urlencoded-pm-${idx}-${Math.random().toString(36).substring(2, 6)}`,
                    key: f.key,
                    value: convertPostmanVariables(f.value || ""),
                    enabled: f.disabled !== true,
                    type: "text",
                  });
                });
              }
            }

            const requestId = `req-pm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            const newRequest: RequestItem = {
              id: requestId,
              collectionId,
              folderId: parentFolderId,
              name: item.name || "Untitled Request",
              method: method as any,
              url: urlStr,
              headers,
              params,
              auth: {
                type: authType,
                bearerToken,
                basicUsername,
                basicPassword,
                apiKeyKey,
                apiKeyValue,
                apiKeyAddTo,
              },
              body: {
                type: bodyType,
                content: bodyContent,
                formParams,
              },
              createdAt: Date.now() + requestsCount,
              updatedAt: Date.now() + requestsCount,
            };

            await db.requests.add(newRequest);
            requestsCount++;
          }
        }
      }

      if (Array.isArray(data.item)) {
        await traverseItems(data.item, null);
      }
    });

    return {
      success: true,
      collectionName,
      requestsCount,
      foldersCount,
    };
  } catch (error: any) {
    console.error("Postman import error:", error);
    return {
      success: false,
      collectionName: "",
      requestsCount: 0,
      foldersCount: 0,
      error: error.message || "Unknown file format parsing error.",
    };
  }
}

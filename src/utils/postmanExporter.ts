import { db, type RequestItem } from "../db/db";

/**
 * Helper to convert standard ${var} format to Postman double curly brace {{var}} format.
 */
function convertToPostmanVariables(text: string): string {
  if (!text) return "";
  return text.replace(/\$\{\s*([^{}]+?)\s*\}/g, "{{$1}}");
}

/**
 * Maps a single Restman RequestItem to Postman v2.1.0 JSON request format.
 */
function mapRequestToPostman(req: RequestItem) {
  const pmRequest: any = {
    method: req.method,
    header: (req.headers || []).map((h) => ({
      key: h.key,
      value: convertToPostmanVariables(h.value || ""),
      disabled: !h.enabled,
      description: h.description || "",
    })),
    url: {
      raw: convertToPostmanVariables(req.url || ""),
      query: (req.params || []).map((p) => ({
        key: p.key,
        value: convertToPostmanVariables(p.value || ""),
        disabled: !p.enabled,
        description: p.description || "",
      })),
    },
  };

  // Map Auth settings
  if (req.auth && req.auth.type !== "none") {
    pmRequest.auth = {
      type: req.auth.type === "apiKey" ? "apikey" : req.auth.type,
    };

    if (req.auth.type === "bearer") {
      pmRequest.auth.bearer = [
        { key: "token", value: convertToPostmanVariables(req.auth.bearerToken || ""), type: "string" },
      ];
    } else if (req.auth.type === "basic") {
      pmRequest.auth.basic = [
        { key: "username", value: convertToPostmanVariables(req.auth.basicUsername || ""), type: "string" },
        { key: "password", value: convertToPostmanVariables(req.auth.basicPassword || ""), type: "string" },
      ];
    } else if (req.auth.type === "apiKey") {
      pmRequest.auth.apikey = [
        { key: "key", value: convertToPostmanVariables(req.auth.apiKeyKey || ""), type: "string" },
        { key: "value", value: convertToPostmanVariables(req.auth.apiKeyValue || ""), type: "string" },
        { key: "in", value: req.auth.apiKeyAddTo || "header", type: "string" },
      ];
    }
  }

  // Map Body content
  if (req.body && req.body.type !== "none") {
    let mode = "raw";
    if (req.body.type === "form-data") mode = "formdata";
    else if (req.body.type === "urlencoded") mode = "urlencoded";

    pmRequest.body = {
      mode,
    };

    if (req.body.type === "form-data") {
      pmRequest.body.formdata = (req.body.formParams || []).map((fp) => ({
        key: fp.key,
        value: convertToPostmanVariables(fp.value || ""),
        disabled: !fp.enabled,
        type: fp.type || "text",
      }));
    } else if (req.body.type === "urlencoded") {
      pmRequest.body.urlencoded = (req.body.formParams || []).map((fp) => ({
        key: fp.key,
        value: convertToPostmanVariables(fp.value || ""),
        disabled: !fp.enabled,
        type: "text",
      }));
    } else {
      // raw types (json, xml, raw)
      pmRequest.body.raw = convertToPostmanVariables(req.body.content || "");
      pmRequest.body.options = {
        raw: {
          language: req.body.type === "json" ? "json" : req.body.type === "xml" ? "xml" : "text",
        },
      };
    }
  }

  return {
    name: req.name,
    request: pmRequest,
    response: [],
  };
}

/**
 * Queries IndexedDB for a collection's folders and requests, and compiles them
 * into a JSON string conforming to the Postman Collection v2.1.0 format.
 */
export async function exportPostmanCollection(collectionId: string): Promise<string> {
  const collection = await db.collections.get(collectionId);
  if (!collection) {
    throw new Error("Collection not found");
  }

  const allFolders = await db.folders.where("collectionId").equals(collectionId).toArray();
  const allRequests = await db.requests.where("collectionId").equals(collectionId).toArray();

  // Recursive builder to assemble folders and requests hierarchically
  function getFolderItems(folderId: string | null): any[] {
    const items: any[] = [];

    // 1. Compile subfolders (loose check to match null/undefined)
    const subFolders = allFolders.filter((f) => 
      folderId === null ? f.parentFolderId == null : f.parentFolderId === folderId
    );
    // Sort folders by creation date or name to maintain order
    subFolders.sort((a, b) => a.createdAt - b.createdAt);
    subFolders.forEach((folder) => {
      items.push({
        name: folder.name,
        item: getFolderItems(folder.id),
      });
    });

    // 2. Compile requests in this folder (loose check to match null/undefined)
    const folderReqs = allRequests.filter((r) => 
      folderId === null ? r.folderId == null : r.folderId === folderId
    );
    folderReqs.sort((a, b) => a.createdAt - b.createdAt);
    folderReqs.forEach((req) => {
      items.push(mapRequestToPostman(req));
    });

    return items;
  }

  const rootItems = getFolderItems(null);

  const postmanCollection = {
    info: {
      name: collection.name,
      description: collection.description || "Exported from RestMan",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: rootItems,
  };

  return JSON.stringify(postmanCollection, null, 2);
}

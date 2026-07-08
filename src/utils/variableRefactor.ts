import { db } from "../db/db";

/**
 * Refactors all occurrences of a variable value across the entire workspace
 * with its variable reference `${varName}`.
 */
export async function refactorVariableOccurrences(varName: string, varValue: string): Promise<number> {
  if (!varName || !varValue || varValue.trim() === "") return 0;

  const targetToken = `\${${varName}}`;
  let updateCount = 0;

  try {
    // 1. Refactor Requests
    const requests = await db.requests.toArray();
    for (const req of requests) {
      let isModified = false;

      // URL
      if (req.url && req.url.includes(varValue)) {
        req.url = req.url.split(varValue).join(targetToken);
        isModified = true;
      }

      // Params
      if (Array.isArray(req.params)) {
        req.params = req.params.map((p) => {
          let pModified = false;
          let k = p.key;
          let v = p.value;
          if (k && k.includes(varValue)) {
            k = k.split(varValue).join(targetToken);
            pModified = true;
          }
          if (v && v.includes(varValue)) {
            v = v.split(varValue).join(targetToken);
            pModified = true;
          }
          if (pModified) isModified = true;
          return { ...p, key: k, value: v };
        });
      }

      // Headers
      if (Array.isArray(req.headers)) {
        req.headers = req.headers.map((h) => {
          let hModified = false;
          let k = h.key;
          let v = h.value;
          if (k && k.includes(varValue)) {
            k = k.split(varValue).join(targetToken);
            hModified = true;
          }
          if (v && v.includes(varValue)) {
            v = v.split(varValue).join(targetToken);
            hModified = true;
          }
          if (hModified) isModified = true;
          return { ...h, key: k, value: v };
        });
      }

      // Body (raw content / formParams)
      if (req.body) {
        if (req.body.content && req.body.content.includes(varValue)) {
          req.body.content = req.body.content.split(varValue).join(targetToken);
          isModified = true;
        }
        if (Array.isArray(req.body.formParams)) {
          req.body.formParams = req.body.formParams.map((fp) => {
            let fpModified = false;
            let k = fp.key;
            let v = fp.value;
            if (k && k.includes(varValue)) {
              k = k.split(varValue).join(targetToken);
              fpModified = true;
            }
            if (v && v.includes(varValue)) {
              v = v.split(varValue).join(targetToken);
              fpModified = true;
            }
            if (fpModified) isModified = true;
            return { ...fp, key: k, value: v };
          });
        }
      }

      if (isModified) {
        await db.requests.update(req.id, {
          url: req.url,
          params: req.params,
          headers: req.headers,
          body: req.body,
          updatedAt: Date.now()
        });
        updateCount++;
      }
    }

    // 2. Refactor Active Tabs
    const tabs = await db.tabs.toArray();
    for (const tab of tabs) {
      let isModified = false;
      if (tab.url && tab.url.includes(varValue)) {
        tab.url = tab.url.split(varValue).join(targetToken);
        isModified = true;
      }
      if (isModified) {
        await db.tabs.update(tab.id, {
          url: tab.url
        });
      }
    }
  } catch (err) {
    console.error("Failed to refactor variable occurrences:", err);
  }

  return updateCount;
}

/**
 * Replaces all variable references like ${varName} across the entire workspace
 * with their hardcoded value, back to original state before deletion.
 */
export async function dereferenceVariableOccurrences(varName: string, varValue: string): Promise<number> {
  if (!varName) return 0;
  const targetToken = `\${${varName}}`;
  const resolvedValue = varValue || "";
  let updateCount = 0;

  try {
    // 1. Dereference Requests
    const requests = await db.requests.toArray();
    for (const req of requests) {
      let isModified = false;

      // URL
      if (req.url && req.url.includes(targetToken)) {
        req.url = req.url.split(targetToken).join(resolvedValue);
        isModified = true;
      }

      // Params
      if (Array.isArray(req.params)) {
        req.params = req.params.map((p) => {
          let pModified = false;
          let k = p.key;
          let v = p.value;
          if (k && k.includes(targetToken)) {
            k = k.split(targetToken).join(resolvedValue);
            pModified = true;
          }
          if (v && v.includes(targetToken)) {
            v = v.split(targetToken).join(resolvedValue);
            pModified = true;
          }
          if (pModified) isModified = true;
          return { ...p, key: k, value: v };
        });
      }

      // Headers
      if (Array.isArray(req.headers)) {
        req.headers = req.headers.map((h) => {
          let hModified = false;
          let k = h.key;
          let v = h.value;
          if (k && k.includes(targetToken)) {
            k = k.split(targetToken).join(resolvedValue);
            hModified = true;
          }
          if (v && v.includes(targetToken)) {
            v = v.split(targetToken).join(resolvedValue);
            hModified = true;
          }
          if (hModified) isModified = true;
          return { ...h, key: k, value: v };
        });
      }

      // Body (raw content / formParams)
      if (req.body) {
        if (req.body.content && req.body.content.includes(targetToken)) {
          req.body.content = req.body.content.split(targetToken).join(resolvedValue);
          isModified = true;
        }
        if (Array.isArray(req.body.formParams)) {
          req.body.formParams = req.body.formParams.map((fp) => {
            let fpModified = false;
            let k = fp.key;
            let v = fp.value;
            if (k && k.includes(targetToken)) {
              k = k.split(targetToken).join(resolvedValue);
              fpModified = true;
            }
            if (v && v.includes(targetToken)) {
              v = v.split(targetToken).join(resolvedValue);
              fpModified = true;
            }
            if (fpModified) isModified = true;
            return { ...fp, key: k, value: v };
          });
        }
      }

      if (isModified) {
        await db.requests.update(req.id, {
          url: req.url,
          params: req.params,
          headers: req.headers,
          body: req.body,
          updatedAt: Date.now()
        });
        updateCount++;
      }
    }

    // 2. Dereference Active Tabs
    const tabs = await db.tabs.toArray();
    for (const tab of tabs) {
      let isModified = false;
      if (tab.url && tab.url.includes(targetToken)) {
        tab.url = tab.url.split(targetToken).join(resolvedValue);
        isModified = true;
      }
      if (isModified) {
        await db.tabs.update(tab.id, {
          url: tab.url
        });
      }
    }
  } catch (err) {
    console.error("Failed to dereference variable occurrences:", err);
  }

  return updateCount;
}

/**
 * Renames all variable references from ${oldName} to ${newName} across the entire workspace.
 */
export async function renameVariableOccurrences(oldName: string, newName: string): Promise<number> {
  if (!oldName || !newName) return 0;
  const oldToken = `\${${oldName}}`;
  const newToken = `\${${newName}}`;
  let updateCount = 0;

  try {
    // 1. Rename in Requests
    const requests = await db.requests.toArray();
    for (const req of requests) {
      let isModified = false;

      // URL
      if (req.url && req.url.includes(oldToken)) {
        req.url = req.url.split(oldToken).join(newToken);
        isModified = true;
      }

      // Params
      if (Array.isArray(req.params)) {
        req.params = req.params.map((p) => {
          let pModified = false;
          let k = p.key;
          let v = p.value;
          if (k && k.includes(oldToken)) {
            k = k.split(oldToken).join(newToken);
            pModified = true;
          }
          if (v && v.includes(oldToken)) {
            v = v.split(oldToken).join(newToken);
            pModified = true;
          }
          if (pModified) isModified = true;
          return { ...p, key: k, value: v };
        });
      }

      // Headers
      if (Array.isArray(req.headers)) {
        req.headers = req.headers.map((h) => {
          let hModified = false;
          let k = h.key;
          let v = h.value;
          if (k && k.includes(oldToken)) {
            k = k.split(oldToken).join(newToken);
            hModified = true;
          }
          if (v && v.includes(oldToken)) {
            v = v.split(oldToken).join(newToken);
            hModified = true;
          }
          if (hModified) isModified = true;
          return { ...h, key: k, value: v };
        });
      }

      // Body (raw content / formParams)
      if (req.body) {
        if (req.body.content && req.body.content.includes(oldToken)) {
          req.body.content = req.body.content.split(oldToken).join(newToken);
          isModified = true;
        }
        if (Array.isArray(req.body.formParams)) {
          req.body.formParams = req.body.formParams.map((fp) => {
            let fpModified = false;
            let k = fp.key;
            let v = fp.value;
            if (k && k.includes(oldToken)) {
              k = k.split(oldToken).join(newToken);
              fpModified = true;
            }
            if (v && v.includes(oldToken)) {
              v = v.split(oldToken).join(newToken);
              fpModified = true;
            }
            if (fpModified) isModified = true;
            return { ...fp, key: k, value: v };
          });
        }
      }

      if (isModified) {
        await db.requests.update(req.id, {
          url: req.url,
          params: req.params,
          headers: req.headers,
          body: req.body,
          updatedAt: Date.now()
        });
        updateCount++;
      }
    }

    // 2. Rename in Active Tabs
    const tabs = await db.tabs.toArray();
    for (const tab of tabs) {
      let isModified = false;
      if (tab.url && tab.url.includes(oldToken)) {
        tab.url = tab.url.split(oldToken).join(newToken);
        isModified = true;
      }
      if (isModified) {
        await db.tabs.update(tab.id, {
          url: tab.url
        });
      }
    }
  } catch (err) {
    console.error("Failed to rename variable occurrences:", err);
  }

  return updateCount;
}

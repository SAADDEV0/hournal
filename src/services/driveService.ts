
import { APP_FOLDER_NAME } from '../constants';
import { JournalEntry, JournalImage, Mood } from '../types';

const BASE_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';

export const AUTH_ERROR_MSG = 'UNAUTHENTICATED';


async function driveFetch(endpoint: string, accessToken: string, options: RequestInit = {}) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(endpoint, { ...options, headers });
  
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(AUTH_ERROR_MSG);
    }
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message || 'Drive API Error');
  }
  return response;
}

/**
 * Find a file or folder by name inside a specific parent folder
 */
async function findByName(name: string, parentId: string | null, mimeTypeQuery: string, accessToken: string): Promise<string | null> {
  // Escape single quotes for the query
  const safeName = name.replace(/'/g, "\\'");
  let query = `name = '${safeName}' and trashed = false and ${mimeTypeQuery}`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const res = await driveFetch(
    `${BASE_URL}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    accessToken
  );
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

/**
 * Create a folder
 */
async function createFolder(name: string, parentId: string | null, accessToken: string): Promise<string> {
  const body: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    body.parents = [parentId];
  }

  const res = await driveFetch(`${BASE_URL}/files`, accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.id;
}

/**
 * Save an image file
 */
async function saveImageFile(image: JournalImage, parentId: string, entryId: string, accessToken: string) {
  const ext = image.mimeType.split('/')[1] || 'png';
  const filename = `image-${image.id}.${ext}`;
  
  // Check if already exists
  const existingId = await findByName(filename, parentId, "mimeType != 'application/vnd.google-apps.folder'", accessToken);
  if (existingId) return; // Skip if exists

  // Convert Base64 to Blob for upload
  const base64Data = image.data.split(',')[1];
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: image.mimeType });

  // 1. Create Metadata with entryId property for linking
  const metaRes = await driveFetch(`${BASE_URL}/files`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: filename,
      parents: [parentId],
      mimeType: image.mimeType,
      appProperties: { entryId }
    }),
  });
  const fileData = await metaRes.json();

  // 2. Upload Content
  await fetch(`${UPLOAD_URL}/files/${fileData.id}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': image.mimeType,
    },
    body: blob,
  });
}

/**
 * Get or Create Root Folder "ZenJournal"
 */
export async function getAppFolderId(accessToken: string): Promise<string> {
  let rootId = await findByName(APP_FOLDER_NAME, null, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
  if (!rootId) {
    rootId = await createFolder(APP_FOLDER_NAME, null, accessToken);
  }
  return rootId;
}

/**
 * MAIN SYNC TO DRIVE
 */
export async function syncEntryToDrive(entry: JournalEntry, accessToken: string) {
  try {
    // 1. Get or Create Root Folder "ZenJournal"
    const rootId = await getAppFolderId(accessToken);

    // 2. Get Date Name (YYYY-MM-DD)
    const date = new Date(entry.createdAt);
    const dateFolderName = date.toISOString().split('T')[0]; 

    // 3. Get or Create Date Folder
    let dateFolderId = await findByName(dateFolderName, rootId, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
    if (!dateFolderId) {
      dateFolderId = await createFolder(dateFolderName, rootId, accessToken);
    }

    // 4. Prepare Content & Filename
    const moodStr = entry.mood ? `Mood: ${entry.mood}\n` : '';
    // We embed image IDs in the text file as comments or metadata
    const imageMeta = entry.images.length > 0 
        ? `\n\n---\nattachments: ${entry.images.map(i => i.id).join(',')}` 
        : '';
        
    const fileContent = `Title: ${entry.title}\nDate: ${date.toLocaleString()}\n${moodStr}\n${entry.content}${imageMeta}`;
    
    // Sanitize title for filename. Default to "Untitled" if empty.
    const safeTitle = entry.title.replace(/[/\\?%*:|"<>\x00-\x1F]/g, '_').trim() || 'Untitled';
    const desiredFileName = `${safeTitle}.txt`;

    // 5. Find existing file to update
    let fileId: string | null = null;
    let currentFileName: string | null = null;

    // STRATEGY A: Search by Custom Property (Best for files created by this app)
    const qProp = `appProperties has { key='entryId' and value='${entry.id}' } and '${dateFolderId}' in parents and trashed = false`;
    const resProp = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qProp)}&fields=files(id,name)`, accessToken);
    const dataProp = await resProp.json();
    
    if (dataProp.files && dataProp.files.length > 0) {
        fileId = dataProp.files[0].id;
        currentFileName = dataProp.files[0].name;
    } 
    
    // STRATEGY B: If entry.id matches a Drive File ID format (imported files), check if that file exists
    if (!fileId) {
        // Simple heuristic: Drive IDs are usually long alphanumeric strings, local IDs are timestamps (numeric)
        const isDriveId = entry.id.length > 15 && isNaN(Number(entry.id)); 
        if (isDriveId) {
            try {
                const checkRes = await driveFetch(`${BASE_URL}/files/${entry.id}?fields=id,name,trashed`, accessToken);
                const checkData = await checkRes.json();
                if (checkData.id && !checkData.trashed) {
                    fileId = checkData.id;
                    currentFileName = checkData.name;
                }
            } catch (e) { 
                // Ignore 404s
            }
        }
    }

    // STRATEGY C: Fallback - Check by Name to prevent duplicates (Legacy files)
    if (!fileId) {
        // Check for desired name
        const idByName = await findByName(desiredFileName, dateFolderId, "mimeType = 'text/plain'", accessToken);
        if (idByName) {
            fileId = idByName;
            currentFileName = desiredFileName;
        }
        
        // Check for legacy "notes.txt"
        if (!fileId) {
             const idByNotes = await findByName('notes.txt', dateFolderId, "mimeType = 'text/plain'", accessToken);
             if (idByNotes) {
                 fileId = idByNotes;
                 currentFileName = 'notes.txt';
             }
        }
        
        // Check for legacy "entry-{id}.txt"
        if (!fileId) {
             const oldName = `entry-${entry.id}.txt`;
             const idByOldName = await findByName(oldName, dateFolderId, "mimeType = 'text/plain'", accessToken);
             if (idByOldName) {
                 fileId = idByOldName;
                 currentFileName = oldName;
             }
        }
    }

    // 6. Update or Create
    if (fileId) {
        // UPDATE existing file
        await driveFetch(`${UPLOAD_URL}/files/${fileId}?uploadType=media`, accessToken, {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/plain' },
            body: fileContent,
        });

        // Rename Check & Property Injection
        // We always patch the metadata to ensure the title matches and the ID property is set for future robust syncing
        if (currentFileName !== desiredFileName) {
             await driveFetch(`${BASE_URL}/files/${fileId}`, accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ 
                    name: desiredFileName,
                    appProperties: { entryId: entry.id } 
                }),
             });
        } else {
             // Just ensure property is set even if name is correct
             await driveFetch(`${BASE_URL}/files/${fileId}`, accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ 
                    appProperties: { entryId: entry.id } 
                }),
             });
        }
    } else {
        // CREATE new file
        const metaRes = await driveFetch(`${BASE_URL}/files`, accessToken, {
            method: 'POST',
            body: JSON.stringify({
                name: desiredFileName,
                parents: [dateFolderId],
                mimeType: 'text/plain',
                appProperties: { entryId: entry.id } // Store ID for stable tracking
            }),
        });
        const fileData = await metaRes.json();
        
        // Upload Content
        await driveFetch(`${UPLOAD_URL}/files/${fileData.id}?uploadType=media`, accessToken, {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/plain' },
            body: fileContent,
        });
    }

    // 7. Save Images
    if (entry.images && entry.images.length > 0) {
      let imagesFolderId = await findByName('images', dateFolderId, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
      if (!imagesFolderId) {
        imagesFolderId = await createFolder('images', dateFolderId, accessToken);
      }
      for (const img of entry.images) {
        await saveImageFile(img, imagesFolderId, entry.id, accessToken);
      }
    }

    return true;
  } catch (error: any) {
    console.error("Drive Sync Error:", error);
    if (error.message === AUTH_ERROR_MSG) throw error;
  }
}

/**
 * Delete Entry from Drive
 */
export async function deleteEntryFromDrive(entry: JournalEntry, accessToken: string) {
    try {
        // 1. Try by Property
        const qProp = `appProperties has { key='entryId' and value='${entry.id}' } and trashed = false`;
        const res = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qProp)}&fields=files(id)`, accessToken);
        const data = await res.json();

        if (data.files && data.files.length > 0) {
             await driveFetch(`${BASE_URL}/files/${data.files[0].id}`, accessToken, { method: 'DELETE' });
             return;
        }
        
        // 2. Try by ID (if entry.id is the file ID)
        const isDriveId = entry.id.length > 15 && isNaN(Number(entry.id));
        if (isDriveId) {
            await driveFetch(`${BASE_URL}/files/${entry.id}`, accessToken, { method: 'DELETE' });
            return;
        }

        // 3. Try by Name (Fallback)
        const safeTitle = entry.title.replace(/[/\\?%*:|"<>\x00-\x1F]/g, '_').trim() || 'Untitled';
        const namesToCheck = [`${safeTitle}.txt`, `entry-${entry.id}.txt`, 'notes.txt'];
        
        // We need the parent date folder to safely delete by name without nuking files in other folders
        const rootId = await getAppFolderId(accessToken);
        const date = new Date(entry.createdAt);
        const dateFolderName = date.toISOString().split('T')[0];
        const dateFolderId = await findByName(dateFolderName, rootId, "mimeType = 'application/vnd.google-apps.folder'", accessToken);

        if (dateFolderId) {
            for (const name of namesToCheck) {
                const fileId = await findByName(name, dateFolderId, "mimeType = 'text/plain'", accessToken);
                if (fileId) {
                     await driveFetch(`${BASE_URL}/files/${fileId}`, accessToken, { method: 'DELETE' });
                     // Don't break, in case multiple exist? No, let's be safe.
                     return;
                }
            }
        }

    } catch (error: any) {
         if (error.message === AUTH_ERROR_MSG) throw error;
         console.error("Delete error", error);
    }
}

// ==================================================================
// SYNC FROM DRIVE LOGIC
// ==================================================================

async function downloadText(fileId: string, accessToken: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/files/${fileId}?alt=media`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  return await res.text();
}

async function downloadImageAsBase64(fileId: string, accessToken: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/files/${fileId}?alt=media`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function parseJournalText(text: string, fileMeta: any): Partial<JournalEntry> {
    const lines = text.split('\n');
    let title = 'Untitled';
    let mood: Mood | undefined = undefined;
    let contentLines: string[] = [];
    let headerEnded = false;

    // Extract Title from filename if possible (more reliable than text content sometimes)
    const nameTitle = fileMeta.name.replace(/\.txt$/, '').replace(/_/g, ' ');
    if (nameTitle && nameTitle !== 'notes' && !nameTitle.startsWith('entry-')) {
        title = nameTitle;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!headerEnded) {
            if (line.startsWith('Title: ')) {
                // Prefer text content title if explicitly set
                const extractedTitle = line.substring(7).trim();
                if (extractedTitle) title = extractedTitle;
            } else if (line.startsWith('Mood: ')) {
                mood = line.substring(6).trim() as Mood;
            } else if (line.trim() === '') {
                if (i + 1 < lines.length && !lines[i+1].startsWith('Mood:') && !lines[i+1].startsWith('Title:') && !lines[i+1].startsWith('Date:')) {
                    headerEnded = true;
                }
            } else if (!line.startsWith('Date:')) {
                 headerEnded = true;
                 contentLines.push(line);
            }
        } else {
            if (line.startsWith('attachments: ')) break;
            if (line.trim() === '---') continue;
            contentLines.push(line);
        }
    }

    // CRITICAL: Use existing entryId property OR File ID to prevent duplication
    const entryId = fileMeta.appProperties?.entryId || fileMeta.id;
    const timestamp = new Date(fileMeta.modifiedTime).getTime();

    return {
        id: entryId,
        title,
        mood,
        content: contentLines.join('\n').trim(),
        updatedAt: timestamp,
        createdAt: timestamp, 
        images: []
    };
}

export async function fetchAllEntriesFromDrive(accessToken: string): Promise<JournalEntry[]> {
    try {
        const rootId = await getAppFolderId(accessToken);
        
        // 1. Get Date Folders
        const qFolders = `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const resFolders = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qFolders)}&fields=files(id,name)`, accessToken);
        const dateFolders = (await resFolders.json()).files || [];
        
        const allEntries: JournalEntry[] = [];

        // 2. Parallel Process Folders
        await Promise.all(dateFolders.map(async (folder: any) => {
            // Get Text Files
            const qFiles = `'${folder.id}' in parents and mimeType = 'text/plain' and trashed = false`;
            const resFiles = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qFiles)}&fields=files(id,name,modifiedTime,appProperties)`, accessToken);
            const textFiles = (await resFiles.json()).files || [];

            // Get Image Files (if any)
            const imagesFolderId = await findByName('images', folder.id, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
            let imageFiles: any[] = [];
            if (imagesFolderId) {
                 const qImages = `'${imagesFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
                 const resImages = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qImages)}&fields=files(id,mimeType,appProperties)`, accessToken);
                 imageFiles = (await resImages.json()).files || [];
            }

            for (const tf of textFiles) {
                try {
                    const content = await downloadText(tf.id, accessToken);
                    const partial = parseJournalText(content, tf);
                    
                    // Match Images: Prefer ID match, fallback loosely
                    const entryImages: JournalImage[] = [];
                    const relatedImages = imageFiles.filter((img: any) => 
                        img.appProperties?.entryId === partial.id || 
                        // Fallback: If we are using File ID as Entry ID, images wont match via appProp yet. 
                        // But usually images are uploaded with the entry.
                        // If no linkage found, we skip adding images to avoid cross-contamination
                        false 
                    );

                    await Promise.all(relatedImages.map(async (imgFile: any) => {
                        const base64 = await downloadImageAsBase64(imgFile.id, accessToken);
                        entryImages.push({
                            id: imgFile.id, 
                            data: base64,
                            mimeType: imgFile.mimeType
                        });
                    }));

                    allEntries.push({
                        ...partial as JournalEntry,
                        images: entryImages
                    });

                } catch (err) {
                    console.error("Error parsing file", tf.name, err);
                }
            }
        }));

        return allEntries;

    } catch (error) {
        console.error("Failed to fetch from Drive", error);
        throw error;
    }
}
//saadzez
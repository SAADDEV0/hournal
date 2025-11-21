
import { APP_FOLDER_NAME } from '../constants';
import { JournalEntry, JournalImage, Mood } from '../types';

const BASE_URL = 'https://www.googleapis.com/drive/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';

export const AUTH_ERROR_MSG = 'UNAUTHENTICATED';

/**
 * Helper to make authorized fetch requests
 */
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
async function findByName(name: string, parentId: string | null, mimeTypeQuery: string, accessToken: string): Promise<{id: string, name: string, parents: string[]} | null> {
  // Escape single quotes for the query
  const safeName = name.replace(/'/g, "\\'");
  let query = `name = '${safeName}' and trashed = false and ${mimeTypeQuery}`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const res = await driveFetch(
    `${BASE_URL}/files?q=${encodeURIComponent(query)}&fields=files(id,name,parents)`,
    accessToken
  );
  const data = await res.json();
  return data.files && data.files.length > 0 ? { id: data.files[0].id, name: data.files[0].name, parents: data.files[0].parents } : null;
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
  const existing = await findByName(filename, parentId, "mimeType != 'application/vnd.google-apps.folder'", accessToken);
  if (existing) return; // Skip if exists

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
  let root = await findByName(APP_FOLDER_NAME, null, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
  if (!root) {
    const id = await createFolder(APP_FOLDER_NAME, null, accessToken);
    return id;
  }
  return root.id;
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
    let dateFolder = await findByName(dateFolderName, rootId, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
    let dateFolderId = dateFolder ? dateFolder.id : null;
    
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
    
    // Determine Filename
    // Priority: User's manually chosen name -> Title-based name -> Untitled
    const safeTitle = entry.title.replace(/[/\\?%*:|"<>\x00-\x1F]/g, '_').trim() || 'Untitled';
    let desiredFileName = entry.driveFileName || `${safeTitle}.txt`;
    
    // Ensure extension
    if (!desiredFileName.toLowerCase().endsWith('.txt')) {
        desiredFileName += '.txt';
    }

    // 5. Find existing file to update
    // We need to find the file wherever it is (Date folder OR Root folder for legacy rescue)
    
    let foundFile: { id: string, name: string, parents: string[] } | null = null;

    // Helper to search for the file in a specific folder using multiple strategies
    const searchInFolder = async (folderId: string) => {
        // A. Custom Property (Best)
        const qProp = `appProperties has { key='entryId' and value='${entry.id}' } and '${folderId}' in parents and trashed = false`;
        const resProp = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qProp)}&fields=files(id,name,parents)`, accessToken);
        const dataProp = await resProp.json();
        if (dataProp.files && dataProp.files.length > 0) return dataProp.files[0];

        // B. ID Match (if entry.id is a Drive ID)
        const isDriveId = entry.id.length > 15 && isNaN(Number(entry.id)); 
        if (isDriveId) {
             try {
                 const res = await driveFetch(`${BASE_URL}/files/${entry.id}?fields=id,name,parents,trashed`, accessToken);
                 const f = await res.json();
                 if (f.id && !f.trashed && f.parents && f.parents.includes(folderId)) return f;
             } catch(e) {}
        }

        // C. Name Match (Legacy / Fallback)
        // If we have a specific driveFileName, check that first
        if (entry.driveFileName) {
            const f = await findByName(entry.driveFileName, folderId, "mimeType = 'text/plain'", accessToken);
            if (f) return f;
        }

        // 1. Desired Name (derived from title if no driveFileName)
        let f = await findByName(desiredFileName, folderId, "mimeType = 'text/plain'", accessToken);
        if (f) return f;
        
        // 2. entry-{id}.txt
        f = await findByName(`entry-${entry.id}.txt`, folderId, "mimeType = 'text/plain'", accessToken);
        if (f) return f;

        // 3. notes.txt (Very old legacy)
        f = await findByName(`notes.txt`, folderId, "mimeType = 'text/plain'", accessToken);
        if (f) return f;

        return null;
    };

    // Step 5a: Search in Correct Date Folder
    foundFile = await searchInFolder(dateFolderId);

    // Step 5b: If not found, Search in ROOT Folder (Rescue misplaced files)
    if (!foundFile) {
        foundFile = await searchInFolder(rootId);
    }

    // 6. Update, Rename, Move
    if (foundFile) {
        const fileId = foundFile.id;
        
        // MOVE if needed
        if (!foundFile.parents.includes(dateFolderId)) {
             const prevParents = foundFile.parents.join(',');
             await driveFetch(`${BASE_URL}/files/${fileId}?addParents=${dateFolderId}&removeParents=${prevParents}`, accessToken, {
                 method: 'PATCH'
             });
        }

        // UPDATE Content
        await driveFetch(`${UPLOAD_URL}/files/${fileId}?uploadType=media`, accessToken, {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/plain' },
            body: fileContent,
        });

        // RENAME & SET PROPERTY
        // We enforce the name matches desiredFileName
        if (foundFile.name !== desiredFileName) {
             await driveFetch(`${BASE_URL}/files/${fileId}`, accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ 
                    name: desiredFileName,
                    appProperties: { entryId: entry.id } 
                }),
             });
        } else {
             // Ensure property is set even if name didn't change
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
      let imagesFolder = await findByName('images', dateFolderId, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
      let imagesFolderId = imagesFolder ? imagesFolder.id : null;
      
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

        // 3. Try by Name (Fallback) - in Date Folder
        const rootId = await getAppFolderId(accessToken);
        const date = new Date(entry.createdAt);
        const dateFolderName = date.toISOString().split('T')[0];
        const dateFolder = await findByName(dateFolderName, rootId, "mimeType = 'application/vnd.google-apps.folder'", accessToken);

        if (dateFolder) {
            const safeTitle = entry.title.replace(/[/\\?%*:|"<>\x00-\x1F]/g, '_').trim() || 'Untitled';
            const namesToCheck = [
                entry.driveFileName,
                `${safeTitle}.txt`, 
                `entry-${entry.id}.txt`, 
                'notes.txt'
            ].filter(Boolean) as string[];
            
            for (const name of namesToCheck) {
                const file = await findByName(name, dateFolder.id, "mimeType = 'text/plain'", accessToken);
                if (file) {
                     await driveFetch(`${BASE_URL}/files/${file.id}`, accessToken, { method: 'DELETE' });
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
    const nameTitle = fileMeta.name.replace(/\.txt$/i, '').replace(/_/g, ' ');
    if (nameTitle && nameTitle !== 'notes' && !nameTitle.startsWith('entry-')) {
        title = nameTitle;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!headerEnded) {
            if (line.startsWith('Title: ')) {
                const extractedTitle = line.substring(7).trim();
                // Only use text title if filename is generic
                if (title === 'Untitled' || fileMeta.name.startsWith('entry-') || fileMeta.name === 'notes.txt') {
                     if (extractedTitle) title = extractedTitle;
                }
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
        driveFileName: fileMeta.name, // Store the source filename!
        images: []
    };
}

export async function fetchAllEntriesFromDrive(accessToken: string): Promise<JournalEntry[]> {
    try {
        const rootId = await getAppFolderId(accessToken);
        
        // 1. Recursive Search for ALL text files in ZenJournal folder (using ancestors)
        // This finds files in Root, in Date folders, or nested deeper.
        // Added Pagination loop to ensure ALL files are retrieved, not just first 100.
        let textFiles: any[] = [];
        let pageToken: string | null = null;
        const qFiles = `'${rootId}' in ancestors and mimeType = 'text/plain' and trashed = false`;
        
        do {
            const res: Response = await driveFetch(
                `${BASE_URL}/files?q=${encodeURIComponent(qFiles)}&fields=nextPageToken,files(id,name,modifiedTime,appProperties,parents)&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`, 
                accessToken
            );
            const data: any = await res.json();
            if (data.files) textFiles = [...textFiles, ...data.files];
            pageToken = data.nextPageToken;
        } while (pageToken);
        
        // 2. Get All Images (recursive with pagination)
        let allImages: any[] = [];
        if (textFiles.length > 0) {
             const qImages = `'${rootId}' in ancestors and mimeType != 'application/vnd.google-apps.folder' and mimeType != 'text/plain' and trashed = false`;
             let imgPageToken: string | null = null;
             
             do {
                 const resImages: Response = await driveFetch(
                     `${BASE_URL}/files?q=${encodeURIComponent(qImages)}&fields=nextPageToken,files(id,mimeType,appProperties,parents)&pageSize=100${imgPageToken ? `&pageToken=${imgPageToken}` : ''}`, 
                     accessToken
                 );
                 const imgData: any = await resImages.json();
                 if (imgData.files) allImages = [...allImages, ...imgData.files];
                 imgPageToken = imgData.nextPageToken;
             } while (imgPageToken);
        }
        
        const allEntries: JournalEntry[] = [];

        // 3. Parse Files with Concurrency Limit
        // Process in chunks to avoid hitting API rate limits or browser connection limits when fetching many files
        const CHUNK_SIZE = 5; 
        for (let i = 0; i < textFiles.length; i += CHUNK_SIZE) {
            const chunk = textFiles.slice(i, i + CHUNK_SIZE);
            
            await Promise.all(chunk.map(async (tf: any) => {
                try {
                    const content = await downloadText(tf.id, accessToken);
                    const partial = parseJournalText(content, tf);
                    
                    // Match Images
                    const entryImages: JournalImage[] = [];
                    const relatedImages = allImages.filter((img: any) => {
                        return img.appProperties?.entryId === partial.id;
                    });

                    // Download images for this entry (concurrency handled by chunk outer loop effectively)
                    await Promise.all(relatedImages.map(async (imgFile: any) => {
                        try {
                            const base64 = await downloadImageAsBase64(imgFile.id, accessToken);
                            entryImages.push({
                                id: imgFile.id, 
                                data: base64,
                                mimeType: imgFile.mimeType
                            });
                        } catch (e) {
                            console.warn("Failed to download image", imgFile.id);
                        }
                    }));

                    allEntries.push({
                        ...partial as JournalEntry,
                        images: entryImages
                    });

                } catch (err) {
                    console.error("Error parsing file", tf.name, err);
                }
            }));
        }

        return allEntries;

    } catch (error) {
        console.error("Failed to fetch from Drive", error);
        throw error;
    }
}

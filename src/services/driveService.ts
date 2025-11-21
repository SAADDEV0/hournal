
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
async function findByName(name: string, parentId: string | null, mimeTypeQuery: string, accessToken: string): Promise<string | null> {
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
    // We embed image IDs in the text file as comments or metadata for easier restoration, though appProperties is primary source of truth
    const imageMeta = entry.images.length > 0 
        ? `\n\n---\nattachments: ${entry.images.map(i => i.id).join(',')}` 
        : '';
        
    const fileContent = `Title: ${entry.title}\nDate: ${date.toLocaleString()}\n${moodStr}\n${entry.content}${imageMeta}`;
    
    // Sanitize title for filename
    const safeTitle = entry.title.replace(/[/\\?%*:|"<>\x00-\x1F]/g, '_').trim() || 'Untitled';
    const desiredFileName = `${safeTitle}.txt`;

    // 5. Find existing file
    let fileId = null;
    let currentFileName = null;

    // 5a. Search by Custom Property (Robust ID check)
    const qProp = `appProperties has { key='entryId' and value='${entry.id}' } and '${dateFolderId}' in parents and trashed = false`;
    const resProp = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qProp)}&fields=files(id,name)`, accessToken);
    const dataProp = await resProp.json();
    
    if (dataProp.files && dataProp.files.length > 0) {
        fileId = dataProp.files[0].id;
        currentFileName = dataProp.files[0].name;
    } else {
        // 5b. Fallback: Search by Old Legacy Name
        const oldName = `entry-${entry.id}.txt`;
        const idByOldName = await findByName(oldName, dateFolderId, "mimeType != 'application/vnd.google-apps.folder'", accessToken);
        if (idByOldName) {
            fileId = idByOldName;
            currentFileName = oldName;
        }
    }

    // 6. Update or Create
    if (fileId) {
        // Update Content
        await driveFetch(`${UPLOAD_URL}/files/${fileId}?uploadType=media`, accessToken, {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/plain' },
            body: fileContent,
        });

        // Explicit Rename Check
        if (currentFileName !== desiredFileName) {
             await driveFetch(`${BASE_URL}/files/${fileId}`, accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ 
                    name: desiredFileName,
                    appProperties: { entryId: entry.id } 
                }),
             });
        }
    } else {
        // Create New File
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
      // Get or Create 'images' folder inside Date Folder
      let imagesFolderId = await findByName('images', dateFolderId, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
      if (!imagesFolderId) {
        imagesFolderId = await createFolder('images', dateFolderId, accessToken);
      }

      // Upload each image, passing entryId to link them
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
        const qProp = `appProperties has { key='entryId' and value='${entry.id}' } and trashed = false`;
        const res = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qProp)}&fields=files(id)`, accessToken);
        const data = await res.json();

        if (data.files && data.files.length > 0) {
             await driveFetch(`${BASE_URL}/files/${data.files[0].id}`, accessToken, { method: 'DELETE' });
             // Note: We don't delete the images currently to be safe, or we could query images with this entryId and delete them.
             return;
        }
        
        // Fallback
        const oldName = `entry-${entry.id}.txt`;
        const qName = `name = '${oldName}' and trashed = false`;
        const resName = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qName)}&fields=files(id)`, accessToken);
        const dataName = await resName.json();
        
        if (dataName.files && dataName.files.length > 0) {
             await driveFetch(`${BASE_URL}/files/${dataName.files[0].id}`, accessToken, { method: 'DELETE' });
        }

    } catch (error: any) {
         if (error.message === AUTH_ERROR_MSG) throw error;
    }
}

// ==================================================================
// SYNC FROM DRIVE LOGIC
// ==================================================================

/**
 * Download file content as text
 */
async function downloadText(fileId: string, accessToken: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/files/${fileId}?alt=media`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  return await res.text();
}

/**
 * Download image as Base64
 */
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

/**
 * Parse a downloaded text file into a JournalEntry structure
 */
function parseJournalText(text: string, fileMeta: any): Partial<JournalEntry> {
    // Simple parsing based on the format:
    // Title: ...
    // Date: ...
    // Mood: ...
    // \n Content
    
    const lines = text.split('\n');
    let title = 'Untitled';
    let mood: Mood | undefined = undefined;
    let contentLines: string[] = [];
    let headerEnded = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!headerEnded) {
            if (line.startsWith('Title: ')) {
                title = line.substring(7).trim();
            } else if (line.startsWith('Mood: ')) {
                mood = line.substring(6).trim() as Mood;
            } else if (line.startsWith('Date: ')) {
                // We largely ignore the text date for the ID/Timestamp, preferring Drive metadata
            } else if (line.trim() === '') {
                // Empty line often separates headers from content
                // If next line doesn't look like a header, we assume start of content
                if (i + 1 < lines.length && !lines[i+1].startsWith('Mood:') && !lines[i+1].startsWith('Title:')) {
                    headerEnded = true;
                }
            } else {
                 // If we encounter a line that doesn't match headers, start content
                 headerEnded = true;
                 contentLines.push(line);
            }
        } else {
            // Check for attachment footer
            if (line.startsWith('attachments: ')) break; // Stop parsing content
            if (line.trim() === '---') continue; // separator
            contentLines.push(line);
        }
    }

    // Use appProperties.entryId if available, otherwise hash the file ID or create one
    const entryId = fileMeta.appProperties?.entryId || `imported-${fileMeta.id}`;
    // Use modifiedTime from Drive as the single source of truth for updatedAt
    const timestamp = new Date(fileMeta.modifiedTime).getTime();

    return {
        id: entryId,
        title,
        mood,
        content: contentLines.join('\n').trim(),
        updatedAt: timestamp,
        createdAt: timestamp, // Approximate if new
        images: []
    };
}

/**
 * Main function to fetch all journal data from Drive
 */
export async function fetchAllEntriesFromDrive(accessToken: string): Promise<JournalEntry[]> {
    try {
        const rootId = await getAppFolderId(accessToken);
        
        // 1. List all Date Folders inside ZenJournal
        const qFolders = `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const resFolders = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qFolders)}&fields=files(id,name)`, accessToken);
        const dateFolders = (await resFolders.json()).files || [];
        
        const allEntries: JournalEntry[] = [];

        // 2. Iterate each Date Folder (Parallelized)
        await Promise.all(dateFolders.map(async (folder: any) => {
            // 2a. Find Text Files in this date folder
            const qFiles = `'${folder.id}' in parents and mimeType = 'text/plain' and trashed = false`;
            const resFiles = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qFiles)}&fields=files(id,name,modifiedTime,appProperties)`, accessToken);
            const textFiles = (await resFiles.json()).files || [];

            // 2b. Find Image Files (if any exist) - We look in 'images' subfolder
            const imagesFolderId = await findByName('images', folder.id, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
            let imageFiles: any[] = [];
            if (imagesFolderId) {
                 const qImages = `'${imagesFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
                 const resImages = await driveFetch(`${BASE_URL}/files?q=${encodeURIComponent(qImages)}&fields=files(id,mimeType,appProperties)`, accessToken);
                 imageFiles = (await resImages.json()).files || [];
            }

            // 3. Process each text file
            for (const tf of textFiles) {
                try {
                    const content = await downloadText(tf.id, accessToken);
                    const partial = parseJournalText(content, tf);
                    
                    // 4. Find associated images
                    // We match images that have appProperties.entryId === partial.id
                    const entryImages: JournalImage[] = [];
                    
                    const relatedImages = imageFiles.filter((img: any) => 
                        img.appProperties?.entryId === partial.id || 
                        // Fallback: if parsing failed or old format, maybe try to match via text content if we implemented that, 
                        // but for now we rely on entryId.
                        // Legacy Fallback: If only 1 text file and images exist, assume they belong together? Risks mismatch.
                        // Let's stick to strict ID matching for safety.
                        false
                    );

                    // Download images (Parallel)
                    await Promise.all(relatedImages.map(async (imgFile: any) => {
                        try {
                            const base64 = await downloadImageAsBase64(imgFile.id, accessToken);
                            // Extract simple ID from filename "image-{id}.png"
                            // but better to just generate a unique ID or use drive ID if needed. 
                            // We'll try to parse the ID from the journal logic if stored, else random.
                            entryImages.push({
                                id: imgFile.id, // Use Drive File ID as local ID to prevent duplicates
                                data: base64,
                                mimeType: imgFile.mimeType
                            });
                        } catch (err) {
                            console.error("Failed to download image", imgFile.id, err);
                        }
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

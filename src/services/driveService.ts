
import { APP_FOLDER_NAME } from '../constants';
import { JournalEntry, JournalImage } from '../types';

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
    `${BASE_URL}/files?q=${encodeURIComponent(query)}&fields=files(id)`,
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
 * Create or Update a Text File
 */
async function saveTextFile(name: string, content: string, parentId: string, accessToken: string) {
  // Check if exists
  const existingId = await findByName(name, parentId, "mimeType != 'application/vnd.google-apps.folder'", accessToken);

  if (existingId) {
    // Update existing file
    return driveFetch(`${UPLOAD_URL}/files/${existingId}?uploadType=media`, accessToken, {
      method: 'PATCH',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    });
  } else {
    // Create new file
    const metaRes = await driveFetch(`${BASE_URL}/files`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name,
        parents: [parentId],
        mimeType: 'text/plain',
      }),
    });
    const fileData = await metaRes.json();
    
    // Upload Content
    return driveFetch(`${UPLOAD_URL}/files/${fileData.id}?uploadType=media`, accessToken, {
      method: 'PATCH',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    });
  }
}

/**
 * Save an image file (Only if it doesn't exist to save bandwidth)
 */
async function saveImageFile(image: JournalImage, parentId: string, accessToken: string) {
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

  // 1. Create Metadata
  const metaRes = await driveFetch(`${BASE_URL}/files`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: filename,
      parents: [parentId],
      mimeType: image.mimeType,
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
 * MAIN SYNC FUNCTION
 * Structure: ZenJournal / YYYY-MM-DD / entry-{id}.txt
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

    // 4. Prepare Content
    const moodStr = entry.mood ? `Mood: ${entry.mood}\n` : '';
    const fileContent = `Title: ${entry.title}\nDate: ${date.toLocaleString()}\n${moodStr}\n${entry.content}`;
    const fileName = `entry-${entry.id}.txt`;

    // 5. Save Text File
    await saveTextFile(fileName, fileContent, dateFolderId, accessToken);

    // 6. Save Images
    if (entry.images && entry.images.length > 0) {
      // Get or Create 'images' folder inside Date Folder
      let imagesFolderId = await findByName('images', dateFolderId, "mimeType = 'application/vnd.google-apps.folder'", accessToken);
      if (!imagesFolderId) {
        imagesFolderId = await createFolder('images', dateFolderId, accessToken);
      }

      // Upload each image
      for (const img of entry.images) {
        await saveImageFile(img, imagesFolderId, accessToken);
      }
    }

    return true;
  } catch (error: any) {
    console.error("Drive Sync Error:", error);
    if (error.message === AUTH_ERROR_MSG) throw error;
  }
}

/**
 * Delete Entry from Drive (Finds file by name and deletes it)
 */
export async function deleteEntryFromDrive(entry: JournalEntry, accessToken: string) {
    try {
        const fileName = `entry-${entry.id}.txt`;
        // Find file globally or in app folder - safer to just search by name and trashed=false
        const fileId = await findByName(fileName, null, "mimeType != 'application/vnd.google-apps.folder'", accessToken);
        
        if (fileId) {
             await driveFetch(`${BASE_URL}/files/${fileId}`, accessToken, {
                method: 'DELETE'
             });
        }
    } catch (error: any) {
        console.error("Drive Delete Error:", error);
         if (error.message === AUTH_ERROR_MSG) throw error;
    }
}

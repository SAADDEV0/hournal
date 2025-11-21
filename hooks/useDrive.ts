import { useState, useEffect } from 'react';
import { getAppFolderId } from '../services/driveService';

export function useDrive(accessToken: string | null) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setFolderId(null);
      return;
    }

    const initDrive = async () => {
      try {
        const id = await getAppFolderId(accessToken);
        setFolderId(id);
      } catch (err: any) {
        console.error("Failed to initialize Drive folder:", err);
        setDriveError(err.message);
      }
    };

    initDrive();
  }, [accessToken]);

  return { folderId, driveError };
}
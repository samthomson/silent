import { useMutation } from "@tanstack/react-query";
import { BlossomUploader } from '@nostrify/nostrify/uploaders';
import { Impure as DMLib } from '@samthomson/nostr-messaging/core';
import type { FileAttachment } from '@samthomson/nostr-messaging/core';

import { useCurrentUser } from "./useCurrentUser";

export function useUploadFile() {
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (params: File | { file: File; encrypt?: boolean }): Promise<FileAttachment | string[][]> => {
      // Support both old API (just File) and new API (object with encrypt flag)
      const file = params instanceof File ? params : params.file;
      const encrypt = params instanceof File ? false : params.encrypt;

      if (!user) {
        throw new Error('Must be logged in to upload files');
      }

      const uploader = new BlossomUploader({
        servers: [
          'https://blossom.primal.net/',
        ],
        signer: user.signer,
      });

      // If encryption is requested, encrypt before upload
      if (encrypt) {
        const attachment = await DMLib.Message.prepareEncryptedAttachment(
          file,
          async (blob: Blob) => {
            // Create a File-like object from blob for uploader
            const blobFile = new File([blob], file.name, { type: 'application/octet-stream' });
            return await uploader.upload(blobFile);
          }
        );
        // Return full FileAttachment object for encrypted uploads
        return attachment;
      }

      // Regular unencrypted upload
      const tags = await uploader.upload(file);
      return tags;
    },
  });
}
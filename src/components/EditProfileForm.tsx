import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, Copy, Check } from 'lucide-react';
import { NSchema as n, type NostrMetadata } from '@nostrify/nostrify';
import { useQueryClient } from '@tanstack/react-query';
import { useUploadFile } from '@/hooks/useUploadFile';
import { nip19 } from 'nostr-tools';
import { useState } from 'react';

export const EditProfileForm: React.FC = () => {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { user, metadata } = useCurrentUser();
  const { mutateAsync: publishEvent, isPending } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { toast } = useToast();

  const npub = user?.pubkey ? nip19.npubEncode(user.pubkey) : '';

  const copyNpub = async () => {
    if (npub) {
      await navigator.clipboard.writeText(npub);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied!',
        description: 'Your npub has been copied to clipboard',
      });
    }
  };

  // Initialize the form with default values
  const form = useForm<NostrMetadata>({
    resolver: zodResolver(n.metadata()),
    defaultValues: {
      name: '',
      picture: '',
    },
  });

  // Update form values when user data is loaded
  useEffect(() => {
    if (metadata) {
      form.reset({
        name: metadata.name || '',
        picture: metadata.picture || '',
      });
    }
  }, [metadata, form]);

  // Handle file uploads for profile picture
  const uploadPicture = async (file: File) => {
    try {
      // The first tuple in the array contains the URL
      const [[_, url]] = await uploadFile(file);
      form.setValue('picture', url);
      toast({
        title: 'Success',
        description: 'Profile picture uploaded successfully',
      });
    } catch (error) {
      console.error('Failed to upload picture:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload profile picture. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const onSubmit = async (values: NostrMetadata) => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to update your profile',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Combine existing metadata with new values
      const data = { ...metadata, ...values };

      // Clean up empty values
      for (const key in data) {
        if (data[key] === '') {
          delete data[key];
        }
      }

      // Publish the metadata event (kind 0)
      await publishEvent({
        kind: 0,
        content: JSON.stringify(data),
      });

      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['logins'] });
      queryClient.invalidateQueries({ queryKey: ['author', user.pubkey] });

      toast({
        title: 'Success',
        description: 'Your profile has been updated',
      });
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast({
        title: 'Error',
        description: 'Failed to update your profile. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Npub Display */}
        <div className="rounded-lg border bg-muted/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground mb-1">Your Public Key (npub)</p>
              <p className="text-sm font-mono truncate">{npub}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={copyNpub}
              className="flex-shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Your name" {...field} />
              </FormControl>
              <FormDescription>
                This is your display name that will be displayed to others.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="picture"
          render={({ field }) => (
            <ImageUploadField
              field={field}
              label="Profile Picture"
              placeholder="https://example.com/profile.jpg"
              description="URL to your profile picture. You can upload an image or provide a URL."
              onUpload={uploadPicture}
            />
          )}
        />

        <Button 
          type="submit" 
          className="w-full md:w-auto" 
          disabled={isPending || isUploading}
        >
          {(isPending || isUploading) && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save Profile
        </Button>
      </form>
    </Form>
  );
};

// Reusable component for image upload fields
interface ImageUploadFieldProps {
  field: {
    value: string | undefined;
    onChange: (value: string) => void;
    name: string;
    onBlur: () => void;
  };
  label: string;
  placeholder: string;
  description: string;
  onUpload: (file: File) => void;
}

const ImageUploadField: React.FC<ImageUploadFieldProps> = ({
  field,
  label,
  placeholder,
  description,
  onUpload,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <FormItem>
      <FormLabel>{label}</FormLabel>
      <div className="flex flex-col gap-2">
        <FormControl>
          <Input
            placeholder={placeholder}
            name={field.name}
            value={field.value ?? ''}
            onChange={e => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        </FormControl>
        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onUpload(file);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Image
          </Button>
          {field.value && (
            <div className="h-10 w-10 rounded overflow-hidden">
              <img 
                src={field.value} 
                alt={`${label} preview`} 
                className="h-full w-full object-cover"
              />
            </div>
          )}
        </div>
      </div>
      <FormDescription>
        {description}
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
};

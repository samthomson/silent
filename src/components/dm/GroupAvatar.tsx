import { useAuthor } from '@/hooks/useAuthor';
import { getDisplayName } from '@/lib/genUserName';
import { getPubkeyColor } from '@/lib/dmUtils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface GroupAvatarProps {
  pubkeys: string[];
  isSelected?: boolean;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}

export const GroupAvatar = ({ pubkeys, isSelected, className, size = 'md' }: GroupAvatarProps) => {
  const author1 = useAuthor(pubkeys[0] || '');
  const author2 = useAuthor(pubkeys[1] || '');
  const author3 = useAuthor(pubkeys[2] || '');
  const author4 = useAuthor(pubkeys[3] || '');

  const authors = [author1, author2, author3, author4];

  const sizeClasses = {
    xs: 'h-4 w-4 text-[8px]',
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-10 w-10 text-sm'
  };

  if (pubkeys.length === 1) {
    const metadata = author1.data?.metadata;
    const displayName = getDisplayName(pubkeys[0], metadata);
    const avatarUrl = metadata?.picture;
    const initials = displayName.slice(0, 2).toUpperCase();
    const bgColor = getPubkeyColor(pubkeys[0]);

    return (
      <Avatar className={cn(
        sizeClasses[size],
        "flex-shrink-0 transition-opacity",
        isSelected !== undefined && !isSelected && "opacity-40",
        className
      )}>
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback className="text-white" style={{ backgroundColor: bgColor }}>{initials}</AvatarFallback>
      </Avatar>
    );
  }

  // For 2 people: split circle vertically
  if (pubkeys.length === 2) {
    return (
      <div className={cn(
        "relative rounded-full overflow-hidden flex-shrink-0 transition-opacity",
        sizeClasses[size],
        isSelected !== undefined && !isSelected && "opacity-40",
        className
      )}>
        {pubkeys.slice(0, 2).map((pubkey, index) => {
          const author = authors[index];
          const metadata = author?.data?.metadata;
          const avatarUrl = metadata?.picture;
          const bgColor = getPubkeyColor(pubkey);

          return (
            <div
              key={pubkey}
              className="absolute inset-0 w-1/2"
              style={{ left: index === 0 ? 0 : '50%' }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" style={{ backgroundColor: bgColor }} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // For 3+ people: split into 4 quarters
  return (
    <div className={cn(
      "relative rounded-full overflow-hidden flex-shrink-0 transition-opacity",
      sizeClasses[size],
      isSelected !== undefined && !isSelected && "opacity-40",
      className
    )}>
      {pubkeys.slice(0, 4).map((pubkey, index) => {
        const author = authors[index];
        const metadata = author?.data?.metadata;
        const avatarUrl = metadata?.picture;
        const bgColor = getPubkeyColor(pubkey);

        const positions = [
          { top: 0, left: 0 }, // top-left
          { top: 0, left: '50%' }, // top-right
          { top: '50%', left: 0 }, // bottom-left
          { top: '50%', left: '50%' }, // bottom-right
        ];

        return (
          <div
            key={pubkey}
            className="absolute w-1/2 h-1/2"
            style={positions[index]}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full" style={{ backgroundColor: bgColor }} />
            )}
          </div>
        );
      })}
    </div>
  );
};


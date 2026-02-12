'use client';

interface FloatingTextItem {
  id: number;
  text: string;
  color: string;
}

interface FloatingTextProps {
  items: FloatingTextItem[];
}

export type { FloatingTextItem };

export default function FloatingText({ items }: FloatingTextProps) {
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      {items.map((item) => (
        <span
          key={item.id}
          className="absolute text-2xl font-black animate-float-up-fade drop-shadow-lg"
          style={{ color: item.color }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

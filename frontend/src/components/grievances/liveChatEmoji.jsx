import React, { useState } from 'react';

/**
 * YouTube Live chat message body: text + custom/channel emoji rendering.
 *
 * Deliberately its own module, separate from YouTubeLiveTab.jsx: this piece
 * has zero dependency on the app's API client, toast library or icon set, so
 * it stays trivially portable to another Blura Saga deployment (or testable
 * in isolation) without dragging the rest of the tab's wiring along with it.
 */

/**
 * One custom/channel emoji image. Falls back to its alt text (the raw
 * message text already carries the ":shortcut:" placeholder as a last
 * resort) if there's no usable URL, or if the image fails to load — never
 * left as a broken-image icon.
 */
export const CustomEmojiImage = ({ part }) => {
    const [broken, setBroken] = useState(false);
    // Only ever render an https URL from YouTube's own CDN payload — never a
    // bare string as markup, always as a plain <img src> attribute value.
    const usable = typeof part.image_url === 'string' && part.image_url.startsWith('https://') && !broken;

    if (!usable) {
        return <span className="text-slate-500">{part.alt ? `:${part.alt}:` : ''}</span>;
    }
    return (
        <img
            src={part.image_url}
            alt={part.alt || 'emoji'}
            title={part.alt || undefined}
            onError={() => setBroken(true)}
            loading="lazy"
            className="inline-block h-[18px] w-[18px] align-text-bottom object-contain"
        />
    );
};

/**
 * Renders a message body in YouTube's original run order.
 *
 * No `display_parts` (the overwhelming majority of messages — plain text,
 * possibly with standard Unicode emoji already inline): render `text`
 * directly, unchanged from before this feature existed. `display_parts` is
 * only ever non-empty when the message contains a custom/channel emoji, in
 * which case it carries the exact positional sequence the parser captured —
 * rendered here in order, never reconstructed by searching `text`.
 */
export const renderMessageBody = (msg) => {
    const parts = msg.display_parts;
    if (!parts || !parts.length) return msg.text;

    return parts.map((p, i) => {
        const key = `${msg.id || msg.message_id}-part-${i}`;
        if (p.part_type === 'custom_emoji') {
            return <CustomEmojiImage key={key} part={p} />;
        }
        return <React.Fragment key={key}>{p.value}</React.Fragment>;
    });
};

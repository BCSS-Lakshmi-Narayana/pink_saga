/**
 * Regression suite for YouTube Live emoji-fidelity rendering.
 *
 * Covers the frontend half of the emoji feature: `renderMessageBody` and
 * `CustomEmojiImage` from liveChatEmoji.jsx, which is deliberately its own
 * module (no dependency on the API client, toast library or icon set used by
 * YouTubeLiveTab.jsx) so it is testable — and portable to another deployment
 * — in isolation from the rest of the tab.
 *
 * Run with: npm test -- --watchAll=false --testPathPattern=liveChatEmoji
 * (or `npm test` interactively — this file matches CRA's default *.test.js pattern)
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { renderMessageBody, CustomEmojiImage } from './liveChatEmoji';

// CRA's default jest setup doesn't set this for React 18's createRoot, so
// act() would otherwise warn on every render even though it works correctly.
global.IS_REACT_ACT_ENVIRONMENT = true;

let container;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(() => {
    document.body.removeChild(container);
    container = null;
});

const renderInto = (node) => {
    act(() => {
        createRoot(container).render(node);
    });
};

const CUSTOM_EMOJI_A = { part_type: 'custom_emoji', emoji_id: 'UCabc123/asset1', image_url: 'https://yt3.ggpht.com/asset1', alt: 'Party Flag' };
const CUSTOM_EMOJI_B = { part_type: 'custom_emoji', emoji_id: 'UCabc123/asset2', image_url: 'https://yt3.ggpht.com/asset2', alt: 'Party Cheer' };

test('1. plain text message renders as the raw text (unchanged from before this feature)', () => {
    const result = renderMessageBody({ id: 'm1', text: 'jai BJP', display_parts: [] });
    expect(result).toBe('jai BJP');
});

test('2/3. text with Unicode emoji (no display_parts) renders as the raw text, emoji inline', () => {
    const result = renderMessageBody({ id: 'm2', text: 'super work 😅🔥', display_parts: [] });
    expect(result).toBe('super work 😅🔥');
});

test('10. a message with no display_parts key at all behaves identically to an empty array', () => {
    const result = renderMessageBody({ id: 'm3', text: 'no emoji here' });
    expect(result).toBe('no emoji here');
});

test('4. text + one custom emoji renders the text and an <img> for the emoji, in order', () => {
    const msg = {
        id: 'm4',
        text: 'great :party-flag:',
        display_parts: [
            { part_type: 'text', value: 'great ' },
            CUSTOM_EMOJI_A,
        ],
    };
    renderInto(<p>{renderMessageBody(msg)}</p>);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe(CUSTOM_EMOJI_A.image_url);
    expect(img.getAttribute('alt')).toBe(CUSTOM_EMOJI_A.alt);
    expect(container.textContent).toBe('great ');
});

test('5/9. multiple custom emojis render one <img> each, in the original order', () => {
    const msg = {
        id: 'm5',
        text: ':party-flag::party-cheer:',
        display_parts: [CUSTOM_EMOJI_A, CUSTOM_EMOJI_B],
    };
    renderInto(<p>{renderMessageBody(msg)}</p>);

    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute('src')).toBe(CUSTOM_EMOJI_A.image_url);
    expect(imgs[1].getAttribute('src')).toBe(CUSTOM_EMOJI_B.image_url);
});

test('6/8/9. mixed text + Unicode emoji (inline) + custom emoji preserves order and text content', () => {
    const msg = {
        id: 'm6',
        text: 'go 🔥 team :party-flag:!',
        display_parts: [
            { part_type: 'text', value: 'go 🔥 team ' },
            CUSTOM_EMOJI_A,
            { part_type: 'text', value: '!' },
        ],
    };
    renderInto(<p>{renderMessageBody(msg)}</p>);

    expect(container.querySelectorAll('img').length).toBe(1);
    // Text content excludes the <img>, so the visible text is the two text parts joined.
    expect(container.textContent).toBe('go 🔥 team !');
});

test('7. emoji-only message renders a single <img> with no surrounding text', () => {
    const msg = { id: 'm7', text: ':party-flag:', display_parts: [CUSTOM_EMOJI_A] };
    renderInto(<p>{renderMessageBody(msg)}</p>);

    expect(container.querySelectorAll('img').length).toBe(1);
    expect(container.textContent).toBe('');
});

test('CustomEmojiImage falls back to alt text when the URL is not https (never renders untrusted markup as a src)', () => {
    renderInto(<CustomEmojiImage part={{ part_type: 'custom_emoji', image_url: 'http://insecure.example/x.png', alt: 'Bad Emoji' }} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(':Bad Emoji:');
});

test('CustomEmojiImage falls back to alt text when the image fails to load', () => {
    renderInto(<CustomEmojiImage part={CUSTOM_EMOJI_A} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    act(() => {
        img.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(`:${CUSTOM_EMOJI_A.alt}:`);
});

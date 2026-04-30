import { describe, it, expect } from 'vitest';
import { buildMetadataURI, parseMetadata } from './metadata';

describe('parseMetadata', () => {
  it('decodes data:application/json URIs', () => {
    const uri = `data:application/json,${encodeURIComponent(
      JSON.stringify({ title: 'Save Turtles', description: 'Hi', image: 'http://x/a.png' }),
    )}`;
    expect(parseMetadata(uri)).toEqual({
      title: 'Save Turtles',
      description: 'Hi',
      image: 'http://x/a.png',
    });
  });

  it('treats a plain https image URL as image-only metadata', () => {
    expect(parseMetadata('https://example.com/x.png')).toEqual({
      image: 'https://example.com/x.png',
      imageOnly: true,
    });
  });

  it('treats ipfs:// CIDs as image-only metadata', () => {
    expect(parseMetadata('ipfs://Qm123')).toEqual({
      image: 'ipfs://Qm123',
      imageOnly: true,
    });
  });

  it('returns an empty metadata when uri is empty', () => {
    expect(parseMetadata('')).toEqual({});
  });

  it('returns an empty metadata when JSON is malformed', () => {
    expect(parseMetadata('data:application/json,not%20json')).toEqual({});
  });
});

describe('buildMetadataURI', () => {
  it('round-trips through parseMetadata', () => {
    const uri = buildMetadataURI({ title: 'a', description: 'b', image: 'c' });
    expect(parseMetadata(uri)).toEqual({ title: 'a', description: 'b', image: 'c' });
  });
});

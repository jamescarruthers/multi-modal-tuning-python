/**
 * Gene Codec - Encode/decode genes to/from hex strings for sharing and seeding
 *
 * Format: Each gene (float64) is stored as a 16-character hex string
 * The full code is prefixed with version and gene count for validation
 *
 * Structure: VV_CC_GENE1GENE2GENE3...
 * - VV: 2-char version (01)
 * - CC: 2-char gene count (hex)
 * - Each gene: 16 hex chars (float64)
 */

const CODEC_VERSION = '01';

/**
 * Encode a float64 to a 16-character hex string
 */
function floatToHex(value: number): string {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false); // big-endian
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += view.getUint8(i).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Decode a 16-character hex string to float64
 */
function hexToFloat(hex: string): number {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  for (let i = 0; i < 8; i++) {
    view.setUint8(i, parseInt(hex.substr(i * 2, 2), 16));
  }
  return view.getFloat64(0, false); // big-endian
}

/**
 * Encode genes array to a hex string
 */
export function encodeGenes(genes: number[]): string {
  const geneCount = genes.length.toString(16).padStart(2, '0');
  const geneHex = genes.map(floatToHex).join('');
  return `${CODEC_VERSION}${geneCount}${geneHex}`;
}

/**
 * Decode a hex string back to genes array
 * Returns null if the string is invalid
 */
export function decodeGenes(code: string): number[] | null {
  try {
    // Remove any whitespace or dashes for flexibility
    const cleaned = code.replace(/[\s-]/g, '').toLowerCase();

    if (cleaned.length < 4) return null;

    const version = cleaned.substring(0, 2);
    if (version !== CODEC_VERSION) {
      console.warn(`Unknown gene code version: ${version}`);
      return null;
    }

    const geneCount = parseInt(cleaned.substring(2, 4), 16);
    const expectedLength = 4 + geneCount * 16;

    if (cleaned.length !== expectedLength) {
      console.warn(`Invalid gene code length: expected ${expectedLength}, got ${cleaned.length}`);
      return null;
    }

    const genes: number[] = [];
    for (let i = 0; i < geneCount; i++) {
      const start = 4 + i * 16;
      const hex = cleaned.substring(start, start + 16);
      genes.push(hexToFloat(hex));
    }

    return genes;
  } catch (e) {
    console.error('Failed to decode gene code:', e);
    return null;
  }
}

/**
 * Validate a gene code without fully decoding
 */
export function isValidGeneCode(code: string): boolean {
  try {
    const cleaned = code.replace(/[\s-]/g, '').toLowerCase();
    if (cleaned.length < 4) return false;

    const version = cleaned.substring(0, 2);
    if (version !== CODEC_VERSION) return false;

    const geneCount = parseInt(cleaned.substring(2, 4), 16);
    const expectedLength = 4 + geneCount * 16;

    return cleaned.length === expectedLength && /^[0-9a-f]+$/.test(cleaned);
  } catch {
    return false;
  }
}

/**
 * Format a gene code for display (with separators for readability)
 */
export function formatGeneCode(code: string): string {
  const cleaned = code.replace(/[\s-]/g, '').toLowerCase();
  // Add dash every 8 characters for readability
  return cleaned.match(/.{1,8}/g)?.join('-') || cleaned;
}

/**
 * Get the expected number of genes for a given number of cuts
 * @param numCuts Number of cuts
 * @param hasLengthAdjust Whether length adjustment is enabled
 */
export function getExpectedGeneCount(numCuts: number, hasLengthAdjust: boolean): number {
  return numCuts * 2 + (hasLengthAdjust ? 1 : 0);
}

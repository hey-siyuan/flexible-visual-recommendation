export const MAX_DIMENSIONS = 8;
export const MAX_DIMENSION_NAME = 80;
export const MAX_PROMPT = 10_000;

export const DEFAULT_DIMENSIONS = [
  { id: 'aesthetic', name: 'Aesthetics', prompt: 'Evaluate the visual appeal of the image. Consider composition, color harmony, and how clearly it guides attention.' },
  { id: 'creativity', name: 'Creativity', prompt: 'Evaluate the originality of the visual idea and how coherently the image develops it.' },
  { id: 'expectation', name: 'Expectation', prompt: 'Evaluate how well the image meets the design brief. If no brief is provided, use the image’s apparent visual intent.' },
];

export function dimensionError(dimensions, sharedPrompt) {
  if (!Array.isArray(dimensions) || dimensions.length < 1 || dimensions.length > MAX_DIMENSIONS) {
    return `Choose between 1 and ${MAX_DIMENSIONS} scoring dimensions.`;
  }
  const ids = new Set();
  const names = new Set();
  let length = 0;
  if (sharedPrompt !== undefined) {
    if (typeof sharedPrompt !== 'string' || !sharedPrompt.trim()) return 'Write an evaluation rubric.';
    length = sharedPrompt.length;
  }
  for (const dimension of dimensions) {
    const { id, name, prompt } = dimension ?? {};
    if (typeof id !== 'string' || !/^(?:aesthetic|creativity|expectation|d[a-z0-9-]{1,48})$/.test(id) || ids.has(id)) {
      return 'Each scoring dimension must have a unique ID.';
    }
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_DIMENSION_NAME) {
      return `Give each dimension a name of 1–${MAX_DIMENSION_NAME} characters.`;
    }
    const normalizedName = name.trim().toLowerCase();
    if (names.has(normalizedName)) return 'Use a different name for each dimension.';
    if (sharedPrompt === undefined) {
      if (typeof prompt !== 'string' || !prompt.trim()) return 'Write a prompt for each dimension.';
      length += prompt.length;
    }
    ids.add(id);
    names.add(normalizedName);
  }
  return length > MAX_PROMPT ? 'Keep the combined prompts to 10,000 characters or fewer.' : '';
}

export interface JudgePreset {
  id: number;
  label: string;
}

/** Preset cross-examination prompts (v0 demo). */
export const JUDGE_PRESETS: JudgePreset[] = [
  { id: 1, label: "State the bull case in one sentence with the key metric." },
  { id: 2, label: "What would falsify this thesis in the next two quarters?" },
  { id: 3, label: "What is the biggest competitive threat and our edge?" },
  { id: 4, label: "Where could estimates be wrong — upside vs downside?" },
  { id: 5, label: "What regulatory or macro risk matters most here?" },
  { id: 6, label: "How does capital allocation score vs peers?" },
  { id: 7, label: "What is the bear case we are not dismissing?" },
  { id: 8, label: "Why is now the right window to own this name?" },
];

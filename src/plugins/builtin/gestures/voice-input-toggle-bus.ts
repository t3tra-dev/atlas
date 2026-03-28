export type VoiceInputToggleEvent = {
  source: "gesture";
  timestampMs: number;
};

type VoiceInputToggleListener = (event: VoiceInputToggleEvent) => void;

const listeners = new Set<VoiceInputToggleListener>();

export function publishVoiceInputToggle(event: VoiceInputToggleEvent) {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeVoiceInputToggle(listener: VoiceInputToggleListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

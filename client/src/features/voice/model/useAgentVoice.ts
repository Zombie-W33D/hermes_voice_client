import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../../../shared/api';

export interface TtsVoice {
  voice: string;
  gender: string;
  locale: string;
  localeName: string;
  friendlyName: string;
}

interface AgentVoiceState {
  catalogue: TtsVoice[];
  current: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setVoice: (voice: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/**
 * Per-agent TTS voice picker: the current voice lives in the agent's hermes
 * profile config (server-side), and the catalogue is the voice list that the
 * free edge endpoint can actually synthesize.
 */
export function useAgentVoice(agentId: string | undefined): AgentVoiceState {
  const [catalogue, setCatalogue] = useState<TtsVoice[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const [catRes, curRes] = await Promise.all([
        fetch(`${API_BASE_URL}/voices`, { headers: authHeaders() }),
        fetch(`${API_BASE_URL}/agent/${agentId}/voice`, { headers: authHeaders() }),
      ]);
      const cat = await catRes.json();
      const cur = await curRes.json();
      if (cat?.ok && Array.isArray(cat.voices)) setCatalogue(cat.voices);
      if (cur?.ok) setCurrent(cur.voice ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voices');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setCatalogue([]);
    setCurrent(null);
    void refresh();
  }, [refresh]);

  const setVoice = useCallback(
    async (voice: string): Promise<boolean> => {
      if (!agentId || saving) return false;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/agent/${agentId}/voice`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ voice }),
        });
        const body = await res.json();
        if (!res.ok || !body?.ok) {
          setError(body?.error || `Failed to set voice (${res.status})`);
          return false;
        }
        setCurrent(body.voice ?? voice);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to set voice');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [agentId, saving]
  );

  return { catalogue, current, loading, saving, error, setVoice, refresh };
}
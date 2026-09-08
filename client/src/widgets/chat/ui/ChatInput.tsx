import { useState, useRef, useCallback } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Chip,
  Popover,
  Autocomplete,
  Typography,
  ListSubheader,
} from '@mui/material';
import {
  Send,
  AttachFile,
  Close,
  InsertDriveFileOutlined,
  ImageOutlined,
  VolumeUp,
  VolumeOff,
  RecordVoiceOver,
} from '@mui/icons-material';
import { useAgentVoice, type TtsVoice } from '../../../features/voice/model/useAgentVoice';

interface ChatInputProps {
  agentId: string;
  onSend: (text: string, files: File[]) => Promise<void>;
  isStreaming: boolean;
  speakRepliesEnabled: boolean;
  onToggleSpeakReplies: () => void;
}

function voiceLabel(v: TtsVoice): string {
  const gender = v.gender?.toLowerCase() === 'female' ? '♀' : v.gender?.toLowerCase() === 'male' ? '♂' : '';
  return `${gender} ${v.voice}`.trim();
}

export default function ChatInput({
  agentId,
  onSend,
  isStreaming,
  speakRepliesEnabled,
  onToggleSpeakReplies,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [voiceAnchor, setVoiceAnchor] = useState<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const voice = useAgentVoice(agentId);

  const voiceOptions = voice.catalogue.map((v) => v.voice);
  const currentVoice = voice.current;

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    []
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    setPendingFiles((prev) => [...prev, ...Array.from(selected)].slice(0, 5));
    e.target.value = '';
    inputRef.current?.focus();
  };

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && pendingFiles.length === 0) || isStreaming) return;

    const filesToSend = [...pendingFiles];
    setText('');
    setPendingFiles([]);
    await onSend(trimmed, filesToSend);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [text, pendingFiles, isStreaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoicePick = async (next: string | null) => {
    if (!next || next === currentVoice) return;
    const ok = await voice.setVoice(next);
    if (ok) setVoiceAnchor(null);
  };

  return (
    <Box
      sx={{
        px: { xs: 2, sm: 2, md: 3 },
        pb: { xs: 'max(12px, env(safe-area-inset-bottom))', md: 2 },
        pt: 1,
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      {pendingFiles.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {pendingFiles.map((f, i) => (
            <Chip
              key={`${f.name}-${i}`}
              icon={
                f.type.startsWith('image/') ? (
                  <ImageOutlined sx={{ fontSize: 14 }} />
                ) : (
                  <InsertDriveFileOutlined sx={{ fontSize: 14 }} />
                )
              }
              label={f.name}
              size="small"
              onDelete={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
              deleteIcon={<Close sx={{ fontSize: 14 }} />}
              sx={{ maxWidth: 200, fontSize: '0.72rem' }}
            />
          ))}
        </Box>
      )}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          px: 1.5,
          py: 0.5,
          bgcolor: 'background.paper',
          '&:focus-within': { borderColor: 'primary.main' },
        }}
      >
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
        <IconButton
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || pendingFiles.length >= 5}
          size="small"
          sx={{ mr: 0.5, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
        >
          <AttachFile sx={{ fontSize: 18 }} />
        </IconButton>
        <IconButton
          onClick={onToggleSpeakReplies}
          size="small"
          sx={{
            mr: 0.5,
            color: speakRepliesEnabled ? 'primary.main' : 'text.secondary',
            '&:hover': { color: 'primary.main' },
          }}
          title={speakRepliesEnabled ? 'Disable spoken replies' : 'Enable spoken replies'}
        >
          {speakRepliesEnabled ? <VolumeUp sx={{ fontSize: 18 }} /> : <VolumeOff sx={{ fontSize: 18 }} />}
        </IconButton>
        <IconButton
          onClick={(e) => setVoiceAnchor(e.currentTarget)}
          size="small"
          sx={{
            mr: 0.5,
            color: voiceAnchor ? 'primary.main' : 'text.secondary',
            '&:hover': { color: 'primary.main' },
          }}
          title={`Voice: ${currentVoice ?? 'agent default'}${voice.saving ? ' (saving…)' : ''}`}
        >
          <RecordVoiceOver sx={{ fontSize: 18 }} />
        </IconButton>
        <Popover
          open={Boolean(voiceAnchor)}
          anchorEl={voiceAnchor}
          onClose={() => setVoiceAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          sx={{ '& .MuiPaper-root': { width: 360, maxWidth: '90vw', p: 1 } }}
        >
          {voice.error && (
            <Typography color="error" variant="caption" sx={{ px: 1, pb: 0.5, display: 'block' }}>
              {voice.error}
            </Typography>
          )}
          <Autocomplete
            size="small"
            options={voiceOptions}
            value={currentVoice ?? null}
            noOptionsText={voice.loading ? 'Loading voices…' : 'No voices found'}
            groupBy={(opt) => {
              const v = voice.catalogue.find((c) => c.voice === opt);
              return v?.localeName || '…';
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                label="Agent voice"
                placeholder="Search voice…"
                size="small"
              />
            )}
            renderGroup={(params) => (
              <Box key={params.key}>
                <ListSubheader sx={{ fontSize: '0.7rem', lineHeight: '24px', bgcolor: 'background.paper' }}>
                  {params.group}
                </ListSubheader>
                {params.children}
              </Box>
            )}
            renderOption={(props, opt) => {
              const v = voice.catalogue.find((c) => c.voice === opt);
              return (
                <Box component="li" {...props} key={opt} sx={{ fontSize: '0.8rem' }}>
                  {v ? voiceLabel(v) : opt}
                </Box>
              );
            }}
            onChange={(_e, next) => void handleVoicePick(next)}
          />
          <Typography variant="caption" sx={{ px: 1, pt: 1, display: 'block', opacity: 0.6 }}>
            {voice.loading && 'Loading… '}
            {!voice.loading && `${voice.catalogue.length} voices available to the free endpoint.`}
          </Typography>
        </Popover>
        <TextField
          inputRef={inputRef}
          fullWidth
          multiline
          minRows={1}
          maxRows={8}
          variant="standard"
          placeholder="Type a message..."
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          slotProps={{ input: { disableUnderline: true, sx: { py: 1, fontSize: '0.9rem' } } }}
          sx={{ minWidth: 0, flex: 1 }}
        />
        <IconButton
          onClick={handleSend}
          disabled={(!text.trim() && pendingFiles.length === 0) || isStreaming}
          size="small"
          sx={{
            ml: 1,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': { bgcolor: 'primary.dark' },
            '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
            width: 32,
            height: 32,
          }}
        >
          <Send sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Box>
  );
}
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ImageBackground,
  Modal,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  Vibration,
  View,
} from 'react-native';

type Mode = 'fast' | 'slow';
type Status = 'idle' | 'running' | 'paused' | 'done';

type Settings = {
  fastSeconds: number;
  slowSeconds: number;
  cycles: number;
  startMode: Mode;
  sound: boolean;
  vibration: boolean;
};

type Session = {
  status: Status;
  offsetSeconds: number;
  startedAtMs: number;
  lastSegment: number;
};

const defaultSettings: Settings = {
  fastSeconds: 180,
  slowSeconds: 180,
  cycles: 5,
  startMode: 'fast',
  sound: true,
  vibration: true,
};

const walkingBackdrop = require('./src/assets/iwt-walking-backdrop.png');
const minuteOptions = [1, 2, 3, 4, 5, 6, 8, 10];
const cycleOptions = [3, 4, 5, 6, 7, 8, 10];

const IwtSession = NativeModules.IwtSession as
  | {
      start: (config: {
        fastSeconds: number;
        slowSeconds: number;
        cycles: number;
        startMode: Mode;
        sound: boolean;
        vibration: boolean;
      }) => Promise<void>;
      pause: () => Promise<void>;
      resume: () => Promise<void>;
      stop: () => Promise<void>;
      isDisclaimerAccepted: () => Promise<boolean>;
      acceptDisclaimer: () => Promise<void>;
    }
  | undefined;

const freshSession = (): Session => ({
  status: 'idle',
  offsetSeconds: 0,
  startedAtMs: 0,
  lastSegment: -1,
});

function App() {
  const [settings, setSettings] = useState(defaultSettings);
  const [draft, setDraft] = useState(defaultSettings);
  const [session, setSession] = useState<Session>(freshSession);
  const [nowMs, setNowMs] = useState(Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sequence = useMemo(() => {
    const first = settings.startMode;
    const second = first === 'fast' ? 'slow' : 'fast';
    return Array.from({length: settings.cycles * 2}, (_, index) =>
      index % 2 === 0 ? first : second,
    );
  }, [settings]);

  const totalSeconds =
    (settings.fastSeconds + settings.slowSeconds) * settings.cycles;

  const elapsedSeconds =
    session.status === 'running'
      ? session.offsetSeconds + (nowMs - session.startedAtMs) / 1000
      : session.offsetSeconds;

  const snapshot = getSnapshot(
    Math.min(elapsedSeconds, totalSeconds),
    sequence,
    settings,
    totalSeconds,
  );

  useEffect(() => {
    IwtSession?.isDisclaimerAccepted?.()
      .then(accepted => setDisclaimerOpen(!accepted))
      .catch(() => setDisclaimerOpen(false));
  }, []);

  useEffect(() => {
    if (session.status !== 'running') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => setNowMs(Date.now()), 250);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [session.status]);

  useEffect(() => {
    if (session.status !== 'running') {
      return;
    }

    if (snapshot.segment !== session.lastSegment) {
      if (session.lastSegment !== -1) {
        if (!IwtSession) {
          cue(snapshot.mode, settings.vibration);
        }
      }
      setSession(current => ({...current, lastSegment: snapshot.segment}));
    }

    if (snapshot.remainingSeconds <= 0) {
      if (settings.vibration) {
        if (!IwtSession) {
          safeVibrate([80, 60, 180]);
        }
      }
      setSession({
        status: 'done',
        offsetSeconds: totalSeconds,
        startedAtMs: 0,
        lastSegment: sequence.length - 1,
      });
    }
  }, [sequence.length, session.lastSegment, session.status, settings.vibration, snapshot, totalSeconds]);

  const modeColor = snapshot.mode === 'fast' ? colors.fast : colors.slow;
  const modeSoft = snapshot.mode === 'fast' ? colors.fastSoft : colors.slowSoft;
  const modeLabel = snapshot.mode === 'fast' ? 'FAST PACE' : 'SLOW PACE';

  async function startPauseResume() {
    if (session.status === 'running') {
      await IwtSession?.pause?.();
      setSession(current => ({
        ...current,
        status: 'paused',
        offsetSeconds:
          current.offsetSeconds + (Date.now() - current.startedAtMs) / 1000,
        startedAtMs: 0,
      }));
      return;
    }

    if (session.status === 'idle' || session.status === 'done') {
      await requestNotificationPermission();
      await IwtSession?.start?.(settings);
      if (!IwtSession) {
        cue(settings.startMode, settings.vibration);
      }
      setSession({
        status: 'running',
        offsetSeconds: 0,
        startedAtMs: Date.now(),
        lastSegment: 0,
      });
      setNowMs(Date.now());
      return;
    }

    await IwtSession?.resume?.();
    setSession(current => ({
      ...current,
      status: 'running',
      startedAtMs: Date.now(),
    }));
    setNowMs(Date.now());
  }

  async function stop() {
    await IwtSession?.stop?.();
    setSession(freshSession());
    setNowMs(Date.now());
  }

  async function acceptDisclaimer() {
    await IwtSession?.acceptDisclaimer?.();
    setDisclaimerOpen(false);
  }

  function openSettings() {
    setDraft(settings);
    setSettingsOpen(true);
  }

  function saveSettings() {
    const next = {
      ...draft,
      fastSeconds: clamp(Math.round(draft.fastSeconds / 60), 1, 30) * 60,
      slowSeconds: clamp(Math.round(draft.slowSeconds / 60), 1, 30) * 60,
      cycles: clamp(draft.cycles, 1, 20),
    };
    setSettings(next);
    setSession(freshSession());
    setSettingsOpen(false);
    setNowMs(Date.now());
  }

  return (
    <ImageBackground
      source={walkingBackdrop}
      resizeMode="cover"
      style={styles.screen}>
      <View style={styles.backdropShade} />
      <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.midnight} />
      <View style={[styles.glow, {backgroundColor: modeSoft}]} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>IWT</Text>
            <Text style={styles.subtitle}>Interval Walking Training</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={openSettings}
            style={({pressed}) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.iconText}>⚙</Text>
          </Pressable>
        </View>

        <View style={[styles.badge, {borderColor: modeColor}]}>
          <View style={[styles.dot, {backgroundColor: modeColor}]} />
          <Text style={styles.badgeText}>{modeLabel}</Text>
        </View>

        <Text style={styles.timer}>{formatTime(snapshot.segmentRemaining)}</Text>

        <View style={styles.panel}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: modeColor,
                  width: `${snapshot.segmentProgress * 100}%`,
                },
              ]}
            />
          </View>

          <View style={styles.pips}>
            {Array.from({length: settings.cycles}, (_, index) => {
              const currentCycle = Math.min(
                settings.cycles - 1,
                Math.floor(snapshot.segment / 2),
              );
              const active = index === currentCycle;
              const done = index < currentCycle;
              return (
                <View
                  key={index}
                  style={[
                    styles.pip,
                    done && {backgroundColor: modeSoft},
                    active && {backgroundColor: modeColor},
                  ]}
                />
              );
            })}
          </View>

          <View style={styles.stats}>
            <Stat
              label="Cycle"
              value={`${Math.min(settings.cycles, Math.floor(snapshot.segment / 2) + 1)} of ${
                settings.cycles
              }`}
            />
            <Stat label="Elapsed" value={formatTime(snapshot.elapsedSeconds)} />
            <Stat
              label="Remaining"
              value={formatTime(snapshot.remainingSeconds)}
            />
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            onPress={startPauseResume}
            style={({pressed}) => [
              styles.primaryButton,
              {backgroundColor: modeColor},
              pressed && styles.pressed,
            ]}>
            <Text style={styles.primaryButtonText}>
              {session.status === 'running'
                ? 'PAUSE'
                : session.status === 'paused'
                  ? 'RESUME'
                  : 'START'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={stop}
            style={({pressed}) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.secondaryButtonText}>STOP</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={disclaimerOpen}
        onRequestClose={() => {}}>
        <View style={styles.disclaimerBackdrop}>
          <View style={styles.disclaimerCard}>
            <Text style={styles.disclaimerTitle}>Before You Walk</Text>
            <Text style={styles.disclaimerText}>
              IWT is a timer and cueing tool for interval walking. It is not
              medical advice, diagnosis, treatment, coaching, emergency support,
              or a guarantee of safety or results.
            </Text>
            <Text style={styles.disclaimerText}>
              You are responsible for deciding whether this activity is safe for
              you, your route, your health, your device, and your surroundings.
              Consult a qualified professional before exercising if you have any
              health concerns. Stop immediately if you feel pain, dizziness,
              shortness of breath, or anything unusual.
            </Text>
            <Text style={styles.disclaimerText}>
              Use this app at your own risk. The app owner and contributors
              provide it as-is, without warranties, and are not responsible for
              injuries, accidents, device issues, data loss, missed cues, or
              other damages from using the app.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={acceptDisclaimer}
              style={[styles.primaryButton, styles.disclaimerButton]}>
              <Text style={styles.primaryButtonText}>I UNDERSTAND AND ACCEPT</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={settingsOpen}
        onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Settings</Text>
            <View style={styles.formGrid}>
              <OptionSelector
                label="Fast minutes"
                value={Math.round(draft.fastSeconds / 60)}
                options={minuteOptions}
                suffix="min"
                accent={colors.fast}
                onChange={value =>
                  setDraft(current => ({
                    ...current,
                    fastSeconds: value * 60,
                  }))
                }
              />
              <OptionSelector
                label="Slow minutes"
                value={Math.round(draft.slowSeconds / 60)}
                options={minuteOptions}
                suffix="min"
                accent={colors.slow}
                onChange={value =>
                  setDraft(current => ({
                    ...current,
                    slowSeconds: value * 60,
                  }))
                }
              />
              <OptionSelector
                label="Cycles"
                value={draft.cycles}
                options={cycleOptions}
                accent={colors.ink}
                onChange={value =>
                  setDraft(current => ({
                    ...current,
                    cycles: value,
                  }))
                }
              />
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Start with</Text>
                <View style={styles.segmented}>
                  {(['fast', 'slow'] as Mode[]).map(mode => (
                    <Pressable
                      key={mode}
                      onPress={() =>
                        setDraft(current => ({...current, startMode: mode}))
                      }
                      style={[
                        styles.segmentButton,
                        draft.startMode === mode && {
                          backgroundColor:
                            mode === 'fast' ? colors.fast : colors.slow,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.segmentText,
                          draft.startMode === mode && styles.segmentTextActive,
                        ]}>
                        {mode.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <ToggleRow
              label="Sound"
              value={draft.sound}
              onValueChange={value =>
                setDraft(current => ({...current, sound: value}))
              }
            />
            <ToggleRow
              label="Vibration"
              value={draft.vibration}
              onValueChange={value =>
                setDraft(current => ({...current, vibration: value}))
              }
            />

            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => setSettingsOpen(false)}
                style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>CANCEL</Text>
              </Pressable>
              <Pressable
                onPress={saveSettings}
                style={[styles.primaryButton, {backgroundColor: modeColor}]}>
                <Text style={styles.primaryButtonText}>SAVE</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </ImageBackground>
  );
}

function getSnapshot(
  elapsedSeconds: number,
  sequence: Mode[],
  settings: Settings,
  totalSeconds: number,
) {
  let cursor = 0;

  for (let segment = 0; segment < sequence.length; segment += 1) {
    const mode = sequence[segment];
    const duration = mode === 'fast' ? settings.fastSeconds : settings.slowSeconds;
    if (elapsedSeconds < cursor + duration || segment === sequence.length - 1) {
      const into = Math.max(0, elapsedSeconds - cursor);
      const segmentRemaining = Math.max(0, Math.ceil(duration - into));
      return {
        elapsedSeconds: Math.floor(elapsedSeconds),
        remainingSeconds: Math.max(0, Math.ceil(totalSeconds - elapsedSeconds)),
        segment,
        mode,
        segmentRemaining,
        segmentProgress: Math.min(1, into / duration),
      };
    }
    cursor += duration;
  }

  return {
    elapsedSeconds: totalSeconds,
    remainingSeconds: 0,
    segment: sequence.length - 1,
    mode: sequence[sequence.length - 1] ?? settings.startMode,
    segmentRemaining: 0,
    segmentProgress: 1,
  };
}

function cue(mode: Mode, vibrationEnabled: boolean) {
  if (vibrationEnabled) {
    safeVibrate(mode === 'fast' ? 60 : 40);
  }
}

function safeVibrate(pattern: number | number[]) {
  try {
    Vibration.vibrate(pattern);
  } catch {
    // A missing device permission or manufacturer quirk should not stop a session.
  }
}

function OptionSelector({
  label,
  value,
  options,
  suffix,
  accent,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  suffix?: string;
  accent: string;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.selectorField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.optionGrid}>
        {options.map(option => {
          const selected = option === value;
          return (
            <Pressable
              accessibilityRole="button"
              key={option}
              onPress={() => onChange(option)}
              style={({pressed}) => [
                styles.optionButton,
                selected && {
                  backgroundColor: accent,
                  borderColor: accent,
                },
                pressed && styles.pressed,
              ]}>
              <Text
                style={[
                  styles.optionText,
                  selected && styles.optionTextActive,
                ]}>
                {suffix ? `${option} ${suffix}` : option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

async function requestNotificationPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) {
    return;
  }
  await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, '0');
  const remainder = String(safeSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

const colors = {
  midnight: '#070A10',
  panel: '#111827',
  panelSoft: '#182033',
  line: '#2B3446',
  ink: '#F8FAFC',
  muted: '#A8B3C7',
  fast: '#FF7A2F',
  fastSoft: '#57311F',
  slow: '#52E6A7',
  slowSoft: '#1C4D3A',
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.midnight,
  },
  safeArea: {
    flex: 1,
  },
  backdropShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(7, 10, 16, 0.76)',
  },
  glow: {
    position: 'absolute',
    top: -90,
    right: -80,
    width: 230,
    height: 230,
    borderRadius: 115,
    opacity: 0.85,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    gap: 18,
    padding: 20,
    paddingBottom: 56,
    paddingTop: 34,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 'auto',
  },
  brand: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#182033',
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  iconText: {
    color: colors.ink,
    fontSize: 20,
  },
  pressed: {
    opacity: 0.72,
    transform: [{scale: 0.98}],
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.panel,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  dot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  badgeText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  timer: {
    color: colors.ink,
    fontSize: 92,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 100,
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 13,
    padding: 14,
  },
  progressTrack: {
    backgroundColor: '#2A3344',
    borderRadius: 99,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 99,
    height: '100%',
  },
  pips: {
    flexDirection: 'row',
    gap: 7,
  },
  pip: {
    backgroundColor: '#313A4D',
    borderRadius: 99,
    flex: 1,
    height: 7,
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
  },
  stat: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 62,
    padding: 10,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  statValue: {
    color: colors.ink,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    marginTop: 7,
  },
  controls: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 54,
  },
  primaryButtonText: {
    color: '#071016',
    fontSize: 16,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.panelSoft,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 54,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.midnight,
    borderColor: colors.line,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  sheetTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  field: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 7,
  },
  selectorField: {
    flexBasis: '100%',
    gap: 8,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    minWidth: 68,
    paddingHorizontal: 12,
  },
  optionText: {
    color: colors.ink,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  optionTextActive: {
    color: '#071016',
  },
  segmented: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    overflow: 'hidden',
  },
  segmentButton: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  segmentText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: '#071016',
  },
  toggleRow: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 12,
  },
  toggleLabel: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
  },
  disclaimerBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.78)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  disclaimerCard: {
    backgroundColor: colors.midnight,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    maxWidth: 480,
    padding: 18,
    width: '100%',
  },
  disclaimerTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '900',
  },
  disclaimerText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  disclaimerButton: {
    backgroundColor: colors.fast,
    marginTop: 6,
  },
});

export default App;

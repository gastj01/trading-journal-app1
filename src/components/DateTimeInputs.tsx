import { TextInput, View, StyleSheet } from 'react-native'

function fmtDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return d.slice(0, 2) + '.' + d.slice(2)
  return d.slice(0, 2) + '.' + d.slice(2, 4) + '.' + d.slice(4)
}

function fmtTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  return d.slice(0, 2) + ':' + d.slice(2)
}

interface Props {
  date: string
  time: string
  onDateChange: (v: string) => void
  onTimeChange: (v: string) => void
  inputStyle?: object
}

export function DateTimeInputs({ date, time, onDateChange, onTimeChange, inputStyle }: Props) {
  return (
    <View style={s.row}>
      <TextInput
        style={[s.input, inputStyle, { flex: 3 }]}
        value={date}
        onChangeText={v => onDateChange(fmtDate(v))}
        placeholder="TT.MM.JJJJ"
        keyboardType="numeric"
        placeholderTextColor="#555"
      />
      <TextInput
        style={[s.input, inputStyle, { flex: 2 }]}
        value={time}
        onChangeText={v => onTimeChange(fmtTime(v))}
        placeholder="HH:MM"
        keyboardType="numeric"
        placeholderTextColor="#555"
      />
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
})

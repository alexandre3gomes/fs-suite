import { TextInput, View } from 'react-native';

export type Picked = { contentType: string; dataBase64: string };

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  // Web-only image upload; unused on native. Kept for prop parity.
  onUpload: (picked: Picked) => Promise<string | null>;
  placeholder?: string;
}

// Native fallback — the rich markdown editor (@uiw) is DOM-only and ships in
// MarkdownEditor.web.tsx. The admin area is used on the web app.
export function MarkdownEditor({
  value,
  onChange,
  editable,
  placeholder,
}: MarkdownEditorProps): JSX.Element {
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={editable}
        multiline
        numberOfLines={10}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        className="min-h-[200px] rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-foreground"
        style={{ textAlignVertical: 'top' }}
      />
    </View>
  );
}

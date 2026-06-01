import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import SimpleMDERaw from 'react-simplemde-editor';

export type Picked = { contentType: string; dataBase64: string };

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  /** Uploads a pasted/dropped/picked image and returns its public URL (or null). */
  onUpload: (picked: Picked) => Promise<string | null>;
  placeholder?: string;
}

// Minimal DOM shapes — the app's tsconfig has no `dom` lib (React Native).
interface WebFile {
  type: string;
}
interface WebFileReader {
  result: unknown;
  onload: () => void;
  onerror: () => void;
  readAsDataURL: (file: WebFile) => void;
}

function readImageFile(file: WebFile): Promise<Picked | null> {
  const g = globalThis as unknown as { FileReader?: new () => WebFileReader };
  const FileReaderCtor = g.FileReader;
  if (!FileReaderCtor) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReaderCtor();
    reader.onload = (): void => {
      resolve({ contentType: file.type, dataBase64: String(reader.result).split(',')[1] ?? '' });
    };
    reader.onerror = (): void => resolve(null);
    reader.readAsDataURL(file);
  });
}

// Load EasyMDE's stylesheet once from the CDN (mirrors how AerodromeMap injects
// Leaflet's CSS) so neither bundle needs a static CSS import.
let cssInjected = false;
function injectCss(): void {
  if (cssInjected) return;
  const g = globalThis as unknown as {
    document?: {
      head: { appendChild: (n: unknown) => void };
      createElement: (tag: string) => { rel: string; href: string };
    };
  };
  const doc = g.document;
  if (!doc) return;
  cssInjected = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/easymde@2.21.0/dist/easymde.min.css';
  doc.head.appendChild(link);
}

type ImageUpload = (
  file: WebFile,
  onSuccess: (url: string) => void,
  onError: (error: string) => void,
) => void;

// Loose facade so we never touch EasyMDE's DOM-referencing option types.
const Editor = SimpleMDERaw as unknown as (props: {
  value: string;
  onChange: (value: string) => void;
  options?: {
    spellChecker: boolean;
    status: boolean;
    placeholder?: string;
    uploadImage: boolean;
    imageUploadFunction: ImageUpload;
    toolbar: (string | '|')[];
  };
}) => JSX.Element;

export function MarkdownEditor({
  value,
  onChange,
  editable,
  onUpload,
  placeholder,
}: MarkdownEditorProps): JSX.Element {
  useEffect(() => {
    injectCss();
  }, []);

  // Keep the upload callback fresh without re-instantiating EasyMDE on every
  // keystroke (re-creating `options` would reset the editor).
  const onUploadRef = useRef(onUpload);
  onUploadRef.current = onUpload;

  const options = useMemo(
    () => ({
      spellChecker: false,
      status: false,
      placeholder,
      uploadImage: true,
      imageUploadFunction: ((file, onSuccess, onError) => {
        void (async () => {
          const picked = await readImageFile(file);
          if (!picked?.dataBase64) return onError('read-failed');
          const url = await onUploadRef.current(picked);
          if (url) onSuccess(url);
          else onError('upload-failed');
        })();
      }) as ImageUpload,
      toolbar: [
        'bold',
        'italic',
        'heading',
        '|',
        'quote',
        'unordered-list',
        'ordered-list',
        '|',
        'link',
        'image',
        '|',
        'preview',
        'guide',
      ],
    }),
    [placeholder],
  );

  // Sent communications are read-only — show the markdown plainly.
  if (!editable) {
    return (
      <ScrollView className="max-h-72 rounded-md border border-border bg-surface-muted px-3 py-2">
        <Text className="text-sm text-foreground">{value}</Text>
      </ScrollView>
    );
  }

  return (
    <View>
      <Editor value={value} onChange={onChange} options={options} />
    </View>
  );
}

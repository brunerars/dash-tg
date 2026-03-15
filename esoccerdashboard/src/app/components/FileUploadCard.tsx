import { Upload, FileSpreadsheet, X } from "lucide-react";
import { useCallback, useState } from "react";

interface FileUploadCardProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  inputId?: string;
}

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls"];

function isSpreadsheet(file: File) {
  return ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

export function FileUploadCard({
  files,
  onFilesChange,
  inputId = "file-upload-input",
}: FileUploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const valid = Array.from(incoming).filter(isSpreadsheet);
      if (valid.length > 0) {
        onFilesChange([...files, ...valid]);
      }
    },
    [files, onFilesChange]
  );

  const removeFile = useCallback(
    (index: number) => {
      onFilesChange(files.filter((_, i) => i !== index));
    },
    [files, onFilesChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(e.target.files);
    }
    // Reset so re-selecting the same files still triggers onChange
    e.target.value = "";
  };

  return (
    <div className="space-y-2">
      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, idx) => (
            <div
              key={`${file.name}-${file.size}-${idx}`}
              className="rounded-xl border border-border bg-card p-4 flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-foreground truncate">{file.name}</p>
                <p className="text-muted-foreground" style={{ fontSize: "0.8rem" }}>
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                onClick={() => removeFile(idx)}
                className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone — always visible so the user can add more files */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
          files.length > 0 ? "p-4" : "p-8"
        } text-center ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-card/50"
        }`}
        onClick={() => document.getElementById(inputId)?.click()}
      >
        <input
          id={inputId}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        <div className="flex flex-col items-center gap-2">
          <div
            className={`rounded-xl bg-primary/10 flex items-center justify-center ${
              files.length > 0 ? "w-8 h-8" : "w-12 h-12"
            }`}
          >
            <Upload className={files.length > 0 ? "w-4 h-4 text-primary" : "w-6 h-6 text-primary"} />
          </div>
          <div>
            <p className="text-foreground" style={files.length > 0 ? { fontSize: "0.85rem" } : undefined}>
              {files.length > 0
                ? "Adicionar mais planilhas"
                : "Arraste o arquivo .xlsx aqui"}
            </p>
            {files.length === 0 && (
              <p className="text-muted-foreground mt-1" style={{ fontSize: "0.85rem" }}>
                ou clique para selecionar (múltiplos arquivos)
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

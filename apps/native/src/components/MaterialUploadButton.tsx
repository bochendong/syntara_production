import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { MATERIAL_ACCEPT } from './CourseMaterialsPage';
import './course-pages.css';

/** 笔记、题库页搜索框旁的上传键：选完文件交给「资料」页去整理。 */
export function MaterialUploadButton({
  label,
  onFiles,
}: {
  label: string;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="material-upload-pill"
        onClick={() => inputRef.current?.click()}
        aria-label={label}
        title={label}
      >
        <Upload size={17} />
        <span>上传</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={MATERIAL_ACCEPT}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

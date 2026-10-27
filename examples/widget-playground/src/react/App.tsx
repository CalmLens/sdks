import { CalmLensMedia, CalmLensUploader } from "@calmlens/sdk/react";
import { useSyncExternalStore } from "react";
import { ACCEPT, GALLERY_SIZES, GALLERY_WIDTHS, MAX_FILE_SIZE, playground } from "../playground";

export function App() {
  const { config, items, ageConfirmed, multiple } = useSyncExternalStore(
    playground.subscribe,
    playground.get,
  );
  return (
    <>
      <section className="panel">
        <h2>Upload</h2>
        <CalmLensUploader
          uploadPresetId={config.uploadPresetId}
          tokenUrl="/api/upload-token"
          baseUrl={config.baseUrl}
          accept={ACCEPT}
          maxFileSize={MAX_FILE_SIZE}
          multiple={multiple}
          onUploaded={(upload) => playground.addUpload(upload, "React")}
        />
      </section>
      <section className="panel">
        <h2>Gallery</h2>
        {items.length === 0 && <p className="empty">Uploads that aren't blocked appear here.</p>}
        <ul className="gallery">
          {items.map((item) => (
            <li key={item.assetId}>
              <CalmLensMedia
                projectId={config.projectId}
                assetId={item.assetId}
                status={item.status}
                viewerClaims={{ ageConfirmed: ageConfirmed }}
                type={item.type}
                alt={item.name}
                aspectRatio={item.aspectRatio}
                widths={GALLERY_WIDTHS}
                sizes={GALLERY_SIZES}
                cdnBaseUrl={config.cdnBaseUrl}
                onReveal={playground.reveal}
              />
              <p className="caption">
                {item.name}{" "}
                <span className="chip" data-status={item.status}>
                  {item.status ?? "submitted"}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

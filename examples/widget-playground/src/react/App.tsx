import { CalmLensAsset, CalmLensUploader } from "calmlens/react";
import { useSyncExternalStore } from "react";
import {
  ACCEPT,
  fetchAssetUrl,
  GALLERY_SIZES,
  GALLERY_WIDTHS,
  MAX_FILE_SIZE,
  playground,
} from "../playground";

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
              <CalmLensAsset
                src={item.src}
                onExpired={() => fetchAssetUrl(item.assetId)}
                viewerClaims={{ ageConfirmed }}
                alt={item.name}
                aspectRatio={item.aspectRatio}
                image={{ widths: GALLERY_WIDTHS, sizes: GALLERY_SIZES }}
                onAgeConfirmRequest={playground.reveal}
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

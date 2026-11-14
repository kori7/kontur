import { formatCopy } from "../api";
import { useEffect, useState } from "react";
import { ArrowDownToLine, FileText, Loader2, TriangleAlert } from "lucide-react";
import { request } from "../api";
import type { Library, LibraryEntry } from "../types";

type Filter = "all" | "candidate" | "excluded";
// A phone shows a dozen cards before the documents; the rest open on request.
const IMAGE_PREVIEW = 12;

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "Все файлы" },
  { id: "candidate", label: "Допущены в выборку" },
  { id: "excluded", label: "Непригодны" },
];

function badgeClass(entry: LibraryEntry) {
  if (entry.training_use === "candidate") return "library-badge candidate support-copy support-copy--semantic";
  if (entry.training_use === "illustration_only") return "library-badge illustration support-copy support-copy--semantic";
  return "library-badge excluded support-copy support-copy--semantic";
}

function matches(entry: LibraryEntry, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "candidate") return entry.training_use === "candidate";
  return entry.training_use !== "candidate";
}

export function LibraryPanel() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<LibraryEntry | null>(null);
  const [allImages, setAllImages] = useState(false);

  useEffect(() => {
    request<Library>("/library")
      .then(setLibrary)
      .catch((cause) => setError((cause as Error).message));
  }, []);

  if (error) {
    return (
      <section className="panel">
        <p className="object-note support-copy">
          <TriangleAlert size={14} /> {formatCopy(error)}
        </p>
      </section>
    );
  }
  if (!library) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin" size={24} />
        <p className="support-copy">Загружаем переданные материалы</p>
      </div>
    );
  }

  const images = library.images.filter((item) => matches(item, filter));
  const documents = library.documents.filter((item) => matches(item, filter));
  // Most images share one view; name it once in the heading and only mark the others on their cards.
  const viewCounts = new Map<string, number>();
  library.images.forEach((item) => viewCounts.set(item.view_label, (viewCounts.get(item.view_label) ?? 0) + 1));
  const commonView = [...viewCounts].sort((a, b) => b[1] - a[1])[0]?.[0];

  return (
    <>
      <section className="panel library-panel">
        <div className="panel-heading">
          <div>
            <h2>Сводка</h2>
            <p className="support-copy">{formatCopy(library.notice)}</p>
          </div>
        </div>
        <div className="passport-grid library-totals">
          <div>
            <small className="support-copy">Изображений</small>
            <strong>{library.totals.images}</strong>
          </div>
          <div>
            <small className="support-copy">Допущено в выборку</small>
            <strong>{library.totals.training_candidates}</strong>
          </div>
          <div>
            <small className="support-copy">Документов</small>
            <strong>{library.totals.documents}</strong>
          </div>
          <div>
            <small className="support-copy">Всего файлов</small>
            <strong>{library.totals.files}</strong>
          </div>
        </div>
        <div className="library-filters">
          {filters.map((item) => (
            <button
              key={item.id}
              className={`button ${filter === item.id ? "primary" : "secondary"} small`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel library-panel">
        <div className="panel-heading">
          <div>
            <h2>Изображения</h2>
            <p className="support-copy">
              {commonView ? `Если не указано иначе — ${formatCopy(commonView).toLowerCase()}` : ""}
            </p>
          </div>
          <span className="tag">{images.length} показано</span>
        </div>
        <div className="library-grid">
          {(allImages || filter !== "all" ? images : images.slice(0, IMAGE_PREVIEW)).map((item) => (
            <button
              key={item.id}
              className="library-card"
              onClick={() => setPreview(item)}
            >
              <img
                src={`/api/library/${item.id}/file`}
                alt={`${item.id}: ${item.shows}`}
                loading="lazy"
              />
              <div className="library-card-body">
                <strong>{item.id}</strong>
                <span className={badgeClass(item)}>{formatCopy(item.training_use_label)}</span>
                <small className="support-copy">{formatCopy(item.provenance_label)}</small>
                {item.view_label !== commonView && <small className="support-copy">{formatCopy(item.view_label)}</small>}
                {item.duplicate_of && <small className="support-copy">Повтор {item.duplicate_of}</small>}
              </div>
            </button>
          ))}
        </div>
        {!allImages && filter === "all" && images.length > IMAGE_PREVIEW && (
          <div className="library-filters">
            <button className="button secondary small" onClick={() => setAllImages(true)}>
              Показать все {images.length}
            </button>
          </div>
        )}
      </section>

      <section className="panel library-panel">
        <div className="panel-heading">
          <div>
            <h2>Документы</h2>
            <p className="support-copy">
              Паспорта, инструкции, опросные листы и сертификаты проекта
              №21031004, а также посторонние файлы, попавшие в комплект
            </p>
          </div>
          <span className="tag">{documents.length} показано</span>
        </div>
        {documents.map((item) => (
          <div className="component-row library-row" key={item.id}>
            <span className="component-code">{item.id}</span>
            <div>
              <strong>{formatCopy(item.note)}</strong>
              <small className="support-copy">
                {item.original_name} · {Math.round(item.bytes / 1024)} КБ
                {item.subject ? ` · объект: ${item.subject}` : ""}
              </small>
            </div>
            {item.viewable_in_browser ? (
              <a
                className="text-button"
                href={`/api/library/${item.id}/file`}
                target="_blank"
                rel="noreferrer"
              >
                <FileText size={14} /> Открыть
              </a>
            ) : (
              <a className="text-button" href={`/api/library/${item.id}/file`}>
                <ArrowDownToLine size={14} /> Скачать
              </a>
            )}
          </div>
        ))}
      </section>

      {preview && (
        <div
          className="library-preview"
          role="dialog"
          aria-label={`Просмотр файла ${preview.id}`}
          onClick={() => setPreview(null)}
        >
          <figure onClick={(event) => event.stopPropagation()}>
            <img src={`/api/library/${preview.id}/file`} alt={preview.shows} />
            <figcaption className="support-copy">
              <strong>
                {preview.id} · {formatCopy(preview.provenance_label)}
              </strong>
              <p className="support-copy">{formatCopy(preview.note)}</p>
              <p className="support-copy">
                {formatCopy(preview.view_label)} · {formatCopy(preview.training_use_label)}
                {preview.editing === "none" ? "" : ` · правка: ${preview.editing}`}
              </p>
              <button
                className="button secondary small"
                onClick={() => setPreview(null)}
              >
                Закрыть
              </button>
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}

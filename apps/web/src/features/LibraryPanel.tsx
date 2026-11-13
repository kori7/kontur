import { useEffect, useState } from "react";
import { ArrowDownToLine, FileText, Loader2, TriangleAlert } from "lucide-react";
import { request } from "../api";
import type { Library, LibraryEntry } from "../types";

type Filter = "all" | "candidate" | "excluded";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "Все файлы" },
  { id: "candidate", label: "Допущены в выборку" },
  { id: "excluded", label: "Непригодны" },
];

function badgeClass(entry: LibraryEntry) {
  if (entry.training_use === "candidate") return "library-badge candidate";
  if (entry.training_use === "illustration_only") return "library-badge illustration";
  return "library-badge excluded";
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

  useEffect(() => {
    request<Library>("/library")
      .then(setLibrary)
      .catch((cause) => setError((cause as Error).message));
  }, []);

  if (error) {
    return (
      <section className="panel">
        <p className="object-note">
          <TriangleAlert size={14} /> {error}
        </p>
      </section>
    );
  }
  if (!library) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin" size={24} />
        <p>Загружаем переданные материалы</p>
      </div>
    );
  }

  const images = library.images.filter((item) => matches(item, filter));
  const documents = library.documents.filter((item) => matches(item, filter));

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Переданные материалы</h2>
            <p>{library.notice}</p>
          </div>
          <span className="tag">{library.totals.files} файлов</span>
        </div>
        <div className="passport-grid library-totals">
          <div>
            <small>Изображений</small>
            <strong>
              {library.totals.images}{" "}
              <span className="tiny muted">
                уникальных {library.totals.unique_images}
              </span>
            </strong>
          </div>
          <div>
            <small>Допущено в выборку</small>
            <strong>{library.totals.training_candidates}</strong>
          </div>
          <div>
            <small>Документов</small>
            <strong>{library.totals.documents}</strong>
          </div>
          <div>
            <small>Всего файлов</small>
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

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Изображения</h2>
            <p>
              Происхождение и пригодность показаны у каждого файла. Кадры со
              стоковым водяным знаком и сгенерированные кадры доступны для
              обзора, но для обучения и публикации непригодны.
            </p>
          </div>
          <span className="tag">{images.length} показано</span>
        </div>
        <div className="library-grid">
          {images.map((item) => (
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
                <span className={badgeClass(item)}>{item.training_use_label}</span>
                <small>{item.provenance_label}</small>
                <small>{item.view_label}</small>
                {item.duplicate_of && <small>Повтор {item.duplicate_of}</small>}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Документы</h2>
            <p>
              Паспорта, инструкции, опросные листы и сертификаты проекта
              №21031004, а также посторонние файлы, попавшие в комплект.
            </p>
          </div>
          <span className="tag">{documents.length} показано</span>
        </div>
        {documents.map((item) => (
          <div className="component-row library-row" key={item.id}>
            <span className="component-code">{item.id}</span>
            <div>
              <strong>{item.note}</strong>
              <small className="muted">
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
            <figcaption>
              <strong>
                {preview.id} · {preview.provenance_label}
              </strong>
              <p>{preview.note}</p>
              <p className="tiny muted">
                {preview.view_label} · {preview.training_use_label}
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

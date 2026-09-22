import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ProjectDTO } from '../../api/types';
import './ProjectTagInput.css';

/** A selected project chip: an existing project (has id) or a pending new one (name only). */
export type Chip =
  | { kind: 'existing'; id: string; name: string; color: string | null }
  | { kind: 'pending'; name: string };

interface ProjectTagInputProps {
  projects: ProjectDTO[];
  value: Chip[];
  onChange: (chips: Chip[]) => void;
}

const RESERVED = 'unassigned';

function chipName(chip: Chip): string {
  return chip.name;
}

export function ProjectTagInput({ projects, value, onChange }: ProjectTagInputProps) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const realProjects = useMemo(() => projects.filter((p) => !p.isDefault), [projects]);

  const chosenLower = useMemo(
    () => new Set(value.map((c) => chipName(c).toLowerCase())),
    [value],
  );

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return realProjects.filter(
      (p) => p.name.toLowerCase().includes(q) && !chosenLower.has(p.name.toLowerCase()),
    );
  }, [text, realProjects, chosenLower]);

  const addChipFromText = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (name.toLowerCase() === RESERVED) {
      setHint('“Unassigned” is reserved.');
      return;
    }
    if (chosenLower.has(name.toLowerCase())) {
      setText('');
      setHint(null);
      return;
    }
    const existing = realProjects.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const chip: Chip = existing
      ? { kind: 'existing', id: existing.id, name: existing.name, color: existing.color }
      : { kind: 'pending', name };
    onChange([...value, chip]);
    setText('');
    setHint(null);
    setActiveIndex(0);
  };

  const addExisting = (p: ProjectDTO) => {
    if (chosenLower.has(p.name.toLowerCase())) return;
    onChange([...value, { kind: 'existing', id: p.id, name: p.name, color: p.color }]);
    setText('');
    setHint(null);
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  const removeLast = () => {
    if (value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (suggestions.length > 0 && text.trim()) {
        // If an active suggestion is highlighted, prefer it; else confirm the text.
        const active = suggestions[activeIndex];
        if (active) {
          addExisting(active);
          return;
        }
      }
      addChipFromText(text);
      return;
    }
    if (e.key === 'Backspace' && text === '') {
      e.preventDefault();
      removeLast();
      return;
    }
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Escape') {
      setText('');
      setHint(null);
    }
  };

  return (
    <div className="tagfield">
      <label className="tagfield__label" htmlFor={`${listId}-input`}>
        Projects
      </label>
      <div className="tagfield__box" onClick={() => inputRef.current?.focus()}>
        {value.map((chip, idx) => (
          <span className="tag" key={`${chipName(chip)}-${idx}`}>
            {chip.kind === 'existing' && chip.color && (
              <span className="tag__dot" style={{ background: chip.color }} aria-hidden="true" />
            )}
            {chipName(chip)}
          </span>
        ))}
        <input
          id={`${listId}-input`}
          ref={inputRef}
          className="tagfield__input"
          type="text"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          value={text}
          placeholder={value.length === 0 ? 'Type a project, Enter to add' : ''}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {suggestions.length > 0 && (
        <ul className="tagfield__suggestions" id={listId} role="listbox">
          {suggestions.map((p, idx) => (
            <li
              key={p.id}
              role="option"
              aria-selected={idx === activeIndex}
              className={idx === activeIndex ? 'tagfield__option tagfield__option--active' : 'tagfield__option'}
              onMouseDown={(e) => {
                e.preventDefault();
                addExisting(p);
              }}
            >
              {p.color && <span className="tag__dot" style={{ background: p.color }} aria-hidden="true" />}
              {p.name}
            </li>
          ))}
        </ul>
      )}

      {suggestions.length === 0 && text.trim() && text.trim().toLowerCase() !== RESERVED && (
        <p className="tagfield__create-hint">Press Enter to create “{text.trim()}”.</p>
      )}

      {hint && (
        <p className="tagfield__hint" role="alert">
          {hint}
        </p>
      )}
    </div>
  );
}

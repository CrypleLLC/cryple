import { describe, expect, it } from "vitest";
import type { PreferenceStorage as VaultStorage } from "./icon-size";
import {
  DEFAULT_ITEM_LAYOUT,
  DOCUMENT_MINIATURE_TEXT_SHARE,
  ICON_SIZES,
  LABEL_CLASSES,
  MINIATURE_TEXT_FLOOR_PIXELS,
  NOTE_MINIATURE_TEXT_SHARE,
  defaultIconSize,
  documentMiniatureTitlePixels,
  gridTemplate,
  iconScale,
  isLargestIconSize,
  isSmallestIconSize,
  largerIconSize,
  miniatureTextPixels,
  pagePixels,
  readIconSize,
  readItemLayout,
  smallerIconSize,
  writeIconSize,
  writeItemLayout,
  type IconGrid,
} from "./index";

const GRIDS: readonly IconGrid[] = ["drive", "notes", "documents"];

function memoryStorage(): VaultStorage {
  const held = new Map<string, string>();

  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
    removeItem: (key) => {
      held.delete(key);
    },
  };
}

describe("the icon scale", () => {
  it("grows strictly from one step to the next, in all three geometries", () => {
    const ascending = (values: number[]) =>
      values.every((value, index) => index === 0 || value > values[index - 1]);

    expect(
      ascending(ICON_SIZES.map((size) => iconScale(size).glyphPixels)),
    ).toBe(true);
    expect(
      ascending(ICON_SIZES.map((size) => iconScale(size).tilePixels)),
    ).toBe(true);
    expect(
      ascending(ICON_SIZES.map((size) => iconScale(size).pagePixels)),
    ).toBe(true);
  });

  it("writes the names smaller at the two smallest steps, and at the body size from medium up", () => {
    expect(iconScale("tiny").labelClass).toBe(LABEL_CLASSES.tiny);
    expect(iconScale("small").labelClass).toBe(LABEL_CLASSES.small);
    for (const size of ["medium", "large", "huge"] as const) {
      expect(iconScale(size).labelClass).toBe(LABEL_CLASSES.regular);
    }
    expect(new Set(Object.values(LABEL_CLASSES)).size).toBe(3);
  });

  it("leaves a drive tile wider than the glyph it holds, so the name has room", () => {
    for (const size of ICON_SIZES) {
      const scale = iconScale(size);
      expect(scale.tilePixels).toBeGreaterThan(scale.glyphPixels);
    }
  });
});

describe("stepping through the sizes", () => {
  it("walks up and back down the whole scale", () => {
    expect(largerIconSize("tiny")).toBe("small");
    expect(largerIconSize("small")).toBe("medium");
    expect(largerIconSize("medium")).toBe("large");
    expect(largerIconSize("large")).toBe("huge");
    expect(smallerIconSize("huge")).toBe("large");
    expect(smallerIconSize("medium")).toBe("small");
    expect(smallerIconSize("small")).toBe("tiny");
  });

  it("holds at the ends rather than wrapping around", () => {
    expect(largerIconSize("huge")).toBe("huge");
    expect(smallerIconSize("tiny")).toBe("tiny");
    expect(isLargestIconSize("huge")).toBe(true);
    expect(isSmallestIconSize("tiny")).toBe(true);
    expect(isSmallestIconSize("small")).toBe(false);
    expect(isLargestIconSize("large")).toBe(false);
    expect(isSmallestIconSize("medium")).toBe(false);
  });
});

describe("the grid each screen draws", () => {
  it("fills the row with whatever fits, rather than a fixed column count", () => {
    expect(gridTemplate("drive", "large")).toBe(
      `repeat(auto-fill, minmax(${iconScale("large").tilePixels}px, 1fr))`,
    );
  });

  it("sizes a page grid by the page, not by the drive tile", () => {
    expect(gridTemplate("notes", "large")).toBe(
      `repeat(auto-fill, ${iconScale("large").pagePixels}px)`,
    );
    expect(gridTemplate("drive", "small")).not.toBe(
      gridTemplate("notes", "small"),
    );
  });

  it("never stretches a note page past its step, so two steps cannot draw the same page", () => {
    for (const size of ICON_SIZES) {
      expect(gridTemplate("notes", size)).not.toContain("1fr");
    }
  });

  it("lays documents out exactly like the drive: its columns, and pages as wide as its glyphs", () => {
    for (const size of ICON_SIZES) {
      expect(gridTemplate("documents", size)).toBe(gridTemplate("drive", size));
      expect(pagePixels("documents", size)).toBe(iconScale(size).glyphPixels);
    }
  });
});

describe("text inside a page miniature", () => {
  it("is a share of the page, so the miniature stays a scale drawing at every step", () => {
    expect(
      miniatureTextPixels("notes", "large", NOTE_MINIATURE_TEXT_SHARE),
    ).toBe(9);
    expect(
      miniatureTextPixels("documents", "huge", DOCUMENT_MINIATURE_TEXT_SHARE),
    ).toBe(6);
    expect(documentMiniatureTitlePixels("huge")).toBe(7);

    expect(
      miniatureTextPixels("notes", "huge", NOTE_MINIATURE_TEXT_SHARE),
    ).toBeGreaterThan(
      miniatureTextPixels("notes", "medium", NOTE_MINIATURE_TEXT_SHARE),
    );
  });

  it("never rounds away to nothing at the smallest step", () => {
    expect(miniatureTextPixels("notes", "small", 0.001)).toBe(
      MINIATURE_TEXT_FLOOR_PIXELS,
    );
    expect(miniatureTextPixels("documents", "small", 0.001)).toBe(
      MINIATURE_TEXT_FLOOR_PIXELS,
    );
  });

  it("keeps a document title larger than its body even where the floor bites", () => {
    for (const size of ICON_SIZES) {
      expect(documentMiniatureTitlePixels(size)).toBeGreaterThan(
        miniatureTextPixels("documents", size, DOCUMENT_MINIATURE_TEXT_SHARE),
      );
    }
  });
});

describe("remembering the chosen size", () => {
  it("reads back what was written, per screen", () => {
    const storage = memoryStorage();
    writeIconSize("drive", "huge", storage);

    expect(readIconSize("drive", storage)).toBe("huge");
    expect(readIconSize("notes", storage)).toBe(defaultIconSize("notes"));
  });

  it("keeps the three screens on separate keys, because they hold different shapes", () => {
    const storage = memoryStorage();
    for (const grid of GRIDS) {
      writeIconSize(grid, "small", storage);
    }

    writeIconSize("drive", "huge", storage);

    expect(readIconSize("drive", storage)).toBe("huge");
    expect(readIconSize("notes", storage)).toBe("small");
    expect(readIconSize("documents", storage)).toBe("small");
  });

  it("opens a page grid larger than an icon grid by default", () => {
    expect(defaultIconSize("drive")).toBe("medium");
    expect(defaultIconSize("notes")).toBe("large");
    expect(defaultIconSize("documents")).toBe("large");
  });

  it("falls back to the default when nothing is stored", () => {
    const storage = memoryStorage();
    for (const grid of GRIDS) {
      expect(readIconSize(grid, storage)).toBe(defaultIconSize(grid));
    }
  });

  it("treats an unrecognised value as no preference at all", () => {
    const storage = memoryStorage();
    storage.setItem("zekke_drive_icon_size", "gigantic");

    expect(readIconSize("drive", storage)).toBe(defaultIconSize("drive"));
  });

  it("is a no-op without storage, so server rendering does not throw", () => {
    expect(() => writeIconSize("notes", "small", undefined)).not.toThrow();
    expect(readIconSize("notes", undefined)).toBe(defaultIconSize("notes"));
  });
});

describe("remembering grid or list", () => {
  it("opens as a grid until a list is chosen", () => {
    const storage = memoryStorage();

    expect(readItemLayout("drive", storage)).toBe(DEFAULT_ITEM_LAYOUT);
    expect(DEFAULT_ITEM_LAYOUT).toBe("grid");
  });

  it("keeps the drive and documents apart", () => {
    const storage = memoryStorage();
    writeItemLayout("drive", "list", storage);

    expect(readItemLayout("drive", storage)).toBe("list");
    expect(readItemLayout("documents", storage)).toBe("grid");
  });

  it("does not share a key with the icon size", () => {
    const storage = memoryStorage();
    writeItemLayout("drive", "list", storage);

    expect(readIconSize("drive", storage)).toBe(defaultIconSize("drive"));
  });

  it("treats an unrecognised value, or no storage, as the grid", () => {
    const storage = memoryStorage();
    storage.setItem("zekke_documents_layout", "table");

    expect(readItemLayout("documents", storage)).toBe("grid");
    expect(readItemLayout("documents", undefined)).toBe("grid");
    expect(() => writeItemLayout("documents", "list", undefined)).not.toThrow();
  });
});

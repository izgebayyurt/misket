import { describe, expect, it } from "vitest";
import { cropStyle, isValidRect, parseGeometry, rectFromPoints } from "./imageCrop";

describe("parseGeometry", () => {
  it("reads a stored rectangle", () => {
    expect(parseGeometry('{"x":0.3,"y":0.4,"w":0.12,"h":0.08}')).toEqual({
      x: 0.3,
      y: 0.4,
      w: 0.12,
      h: 0.08,
    });
    expect(parseGeometry('{"x":0,"y":0,"w":1,"h":1}')).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("returns null for anything it cannot trust", () => {
    expect(parseGeometry(null)).toBeNull();
    expect(parseGeometry("")).toBeNull();
    expect(parseGeometry("not json")).toBeNull();
    expect(parseGeometry("[1,2]")).toBeNull();
    expect(parseGeometry('{"x":0.5,"y":0,"w":0.8,"h":0.1}')).toBeNull(); // runs past the edge
    expect(parseGeometry('{"x":0,"y":0,"w":0,"h":0.1}')).toBeNull(); // no area
    expect(parseGeometry('{"x":-0.1,"y":0,"w":0.5,"h":0.1}')).toBeNull();
    expect(parseGeometry('{"x":0,"y":0,"w":"wide","h":0.1}')).toBeNull();
  });
});

describe("rectFromPoints", () => {
  const near = (
    r: { x: number; y: number; w: number; h: number },
    x: number,
    y: number,
    w: number,
    h: number,
  ) => {
    expect(r.x).toBeCloseTo(x, 10);
    expect(r.y).toBeCloseTo(y, 10);
    expect(r.w).toBeCloseTo(w, 10);
    expect(r.h).toBeCloseTo(h, 10);
  };

  it("normalizes either drag direction", () => {
    near(rectFromPoints(0.2, 0.3, 0.6, 0.8), 0.2, 0.3, 0.4, 0.5);
    near(rectFromPoints(0.6, 0.8, 0.2, 0.3), 0.2, 0.3, 0.4, 0.5);
  });

  it("clamps a drag that leaves the image", () => {
    const r = rectFromPoints(-0.5, 0.5, 1.5, 2);
    near(r, 0, 0.5, 1, 0.5);
    expect(isValidRect(r)).toBe(true);
  });
});

describe("cropStyle", () => {
  it("fills the box when the image size is not known yet", () => {
    const { container, image } = cropStyle(
      { x: 0.25, y: 0.5, w: 0.5, h: 0.5 },
      {
        width: 80,
        height: 60,
      },
    );
    expect(container).toMatchObject({ width: "80px", height: "60px", overflow: "hidden" });
    // Half the image wide and half tall, so the image is twice the box.
    expect(image.width).toBe("160px");
    expect(image.height).toBe("120px");
    expect(image.left).toBe("-40px");
    expect(image.top).toBe("-60px");
  });

  it("keeps the aspect ratio when the image size is known", () => {
    // A 100x100 crop of a 400x200 image shown in an 80x80 box: scale 0.8.
    const { container, image } = cropStyle(
      { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
      { width: 80, height: 80 },
      { width: 400, height: 200 },
    );
    expect(container).toMatchObject({ width: "80px", height: "80px" });
    expect(image.width).toBe("320px");
    expect(image.height).toBe("160px");
    expect(image.left).toBe("-80px");
    expect(image.top).toBe("-80px");
  });

  it("shrinks the box rather than showing pixels outside the region", () => {
    // A square crop (100x100) in a wide box: only 50px tall fits, so the
    // container is 50x50 and no neighbouring image content leaks in.
    const { container, image } = cropStyle(
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { width: 100, height: 50 },
      { width: 200, height: 200 },
    );
    expect(container).toMatchObject({ width: "50px", height: "50px" });
    expect(image.width).toBe("100px");
    expect(image.height).toBe("100px");
    expect(image.left).toBe("0px");
    expect(image.top).toBe("0px");
  });

  it("falls back to the whole image for a broken rectangle", () => {
    const { image } = cropStyle({ x: 0, y: 0, w: 0, h: 0 }, { width: 40, height: 40 });
    expect(image.width).toBe("40px");
    expect(image.height).toBe("40px");
    expect(image.left).toBe("0px");
  });
});

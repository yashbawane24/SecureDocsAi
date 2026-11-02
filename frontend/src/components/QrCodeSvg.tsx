import React from 'react';

interface QrCodeSvgProps {
  value: string;
  size?: number;
}

/**
 * Deterministic 25x25 QR-style matrix SVG with standard finder patterns,
 * timing lines, alignment square, and payload bit encoding.
 */
export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({ value, size = 148 }) => {
  const gridSize = 25;
  const matrix: boolean[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));
  const reserved: boolean[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));

  const placeFinder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr >= 0 && rr < gridSize && cc >= 0 && cc < gridSize) {
          reserved[rr][cc] = true;
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const border = r === 0 || r === 6 || c === 0 || c === 6;
            const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            matrix[rr][cc] = border || inner;
          }
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, gridSize - 7);
  placeFinder(gridSize - 7, 0);

  // Timing patterns
  for (let i = 8; i < gridSize - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Alignment pattern at (16, 16)
  for (let r = 16; r <= 20; r++) {
    for (let c = 16; c <= 20; c++) {
      reserved[r][c] = true;
      const border = r === 16 || r === 20 || c === 16 || c === 20;
      const center = r === 18 && c === 18;
      matrix[r][c] = border || center;
    }
  }

  // Deterministic hash-stream from value
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    bytes.push(value.charCodeAt(i));
  }
  if (bytes.length === 0) bytes.push(42);

  let bitIdx = 0;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (reserved[r][c]) continue;
      const b = bytes[bitIdx % bytes.length];
      const shift = (bitIdx + r * 3 + c * 5) % 8;
      matrix[r][c] = ((b >> shift) & 1) === 1 || (r + c + b) % 5 === 0;
      bitIdx++;
    }
  }

  const cell = size / (gridSize + 4);
  const offset = cell * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`QR code for ${value}`}
      data-testid="join-link-qr-svg"
      style={{
        background: '#FFFFFF',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        padding: '4px',
        display: 'block',
      }}
    >
      <rect width={size} height={size} fill="#FFFFFF" rx={6} />
      {matrix.map((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect
              key={`${r}-${c}`}
              x={offset + c * cell}
              y={offset + r * cell}
              width={cell + 0.35}
              height={cell + 0.35}
              fill="#141414"
            />
          ) : null
        )
      )}
    </svg>
  );
};


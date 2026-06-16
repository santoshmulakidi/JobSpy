import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "linear-gradient(135deg, #0070C0 0%, #004f8c 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* J letter — bold, white */}
        <div
          style={{
            color: "white",
            fontSize: 20,
            fontWeight: 800,
            fontFamily: "Arial, sans-serif",
            lineHeight: 1,
            letterSpacing: "-1px",
            marginTop: 1,
          }}
        >
          J
        </div>
        {/* small lightning bolt accent */}
        <div
          style={{
            position: "absolute",
            bottom: 5,
            right: 6,
            color: "#FFD700",
            fontSize: 10,
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          ⚡
        </div>
      </div>
    ),
    { ...size }
  );
}

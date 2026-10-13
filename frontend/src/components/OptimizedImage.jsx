import { IMAGE_WIDTH, getImageProps } from "../api/api";

/**
 * Serves sized WebP variants through the API (?w=) instead of full uploads.
 * Use for grids/lists; pass variant="detail" for product zoom views.
 */
export default function OptimizedImage({
  src,
  alt = "",
  variant = "card",
  priority = false,
  className = "",
  sizes,
  width,
  style,
  onClick,
}) {
  if (!src) return null;

  const presetWidth = IMAGE_WIDTH[variant] || IMAGE_WIDTH.card;
  const props = getImageProps(src, {
    w: width || presetWidth,
    sizes:
      sizes ||
      (variant === "thumb"
        ? "64px"
        : variant === "tile"
          ? "120px"
          : variant === "detail" || variant === "hero"
            ? "(max-width: 900px) 100vw, 900px"
            : "(max-width: 640px) 46vw, 280px"),
    priority,
    alt,
  });

  if (!props) return null;

  return (
    <img
      {...props}
      className={className}
      onClick={onClick}
      style={style}
    />
  );
}

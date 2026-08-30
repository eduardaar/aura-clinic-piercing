export function ArticleContent({ content, className = "" }) {
  const blocks = String(content || "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const occurrences = new Map();
  const keyedBlocks = blocks.map((block) => {
    const occurrence = (occurrences.get(block) || 0) + 1;
    occurrences.set(block, occurrence);
    return { block, key: `${block}-${occurrence}` };
  });

  return (
    <div className={`article-content${className ? ` ${className}` : ""}`}>
      {keyedBlocks.map(({ block, key }) => {
        const markdownHeading = /^#{1,3}\s+(.+)$/.exec(block);
        const numberedHeading = /^\d+\.\s+(.+)$/.exec(block);
        const heading =
          markdownHeading || (numberedHeading && block.length <= 90 && !/[.!?]$/.test(block) ? numberedHeading : null);
        if (heading) return <h2 key={key}>{heading[1]}</h2>;
        if (/^(?:[-*]\s+.+(?:\n|$))+/.test(block)) {
          return (
            <ul key={key}>
              {block.split("\n").map((item) => (
                <li key={item}>{item.replace(/^[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{block}</p>;
      })}
    </div>
  );
}

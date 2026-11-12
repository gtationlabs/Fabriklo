const ROWS = [
  ["S", "36–38", "30–32", "27"],
  ["M", "38–40", "32–34", "28"],
  ["L", "40–42", "34–36", "29"],
  ["XL", "42–44", "36–38", "30"],
  ["XXL", "44–46", "38–40", "31"],
];

/**
 * Size chart layout for the size guide. The numbers are a SAMPLE so the page
 * can be designed and reviewed; it says so above the table until the store
 * replaces it with measurements of its own garments.
 */
export function SizeChart() {
  return (
    <section aria-labelledby="size-chart-h" className="mt-10" data-testid="size-chart">
      <h2 id="size-chart-h" className="text-[13px] font-semibold uppercase tracking-[0.14em]">
        Size chart (inches)
      </h2>
      <p role="note" className="mt-2 rounded-[4px] border border-neutral-300 bg-mist px-3 py-2 text-[12px] text-neutral-700">
        Sample measurements for layout only. Replace with the measurements of your own garments before launch.
      </p>
      <div className="mt-4 overflow-x-auto rounded-[6px] border border-neutral-200">
        <table className="w-full min-w-[420px] text-left text-[13px]">
          <thead className="bg-ink text-white">
            <tr>
              {["Size", "Chest", "Waist", "Length"].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {ROWS.map(([size, ...cells]) => (
              <tr key={size} className="even:bg-mist">
                <th scope="row" className="px-4 py-3 font-semibold">
                  {size}
                </th>
                {cells.map((c, i) => (
                  <td key={i} className="px-4 py-3 text-neutral-700">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

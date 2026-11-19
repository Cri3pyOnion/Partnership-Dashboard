export function rm(n: number): string {
  return (
    'RM ' +
    n.toLocaleString('en-MY', {
      minimumFractionDigits: n % 1 ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

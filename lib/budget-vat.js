export const VAT_RATE = 0.07;

export function calculateVatInclusiveBudget(totalWithVatInput, spentBeforeVatInput = 0) {
  const totalWithVat = Math.max(0, Number(totalWithVatInput) || 0);
  const spentBeforeVat = Math.max(0, Number(spentBeforeVatInput) || 0);
  const beforeVat = totalWithVat / (1 + VAT_RATE);
  const vatAmount = totalWithVat - beforeVat;
  const spentWithVat = spentBeforeVat * (1 + VAT_RATE);
  const remainBeforeVat = beforeVat - spentBeforeVat;

  return {
    totalWithVat,
    beforeVat,
    vatAmount,
    spentBeforeVat,
    spentWithVat,
    remainBeforeVat,
    remainWithVat: totalWithVat - spentWithVat,
  };
}

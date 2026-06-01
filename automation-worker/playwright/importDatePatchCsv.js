process.env.CSV_OUTPUT = process.env.DATE_PATCH_CSV_OUTPUT || 'exports/date-patch-tickets.csv';

const { main } = await import('./importCsv.js');

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export function QueryState({ query, loading }) {
  if (query.isError) return (
    <div className="query-state" role="alert">
      <p>{query.error.message}</p>
      <button type="button" className="btn ghost" onClick={() => query.refetch()}>Reintentar</button>
    </div>
  );
  return <p className="query-state" role="status">{loading}</p>;
}

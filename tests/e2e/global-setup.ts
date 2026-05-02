export default async function globalSetup() {
  const response = await fetch("http://localhost:5000/api/test/reset-db", {
    method: "POST",
    headers: { "X-Test-Secret": process.env.TEST_SECRET || "test-secret" },
  });
  if (!response.ok) throw new Error("Failed to reset test database");
}

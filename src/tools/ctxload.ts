// Shared "load the world" helper for tool handlers.
//
// Prefer this over hand-rolling getCompanies()+buildGraph() in every tool so
// ticker indexes / graph identity cache stay consistent. Pure convenience —
// behavior matches calling the two functions yourself.
//
// Claude: migrate tool bodies toward this when touching a file (FEATURE_SCAFFOLD §A1).
import { getCompanies, getDeals, getTaxonomy } from "../data";
import { buildGraph, type Graph } from "../graph";
import type { Company, Deal, Taxonomy } from "../types";

export async function loadGraph(): Promise<{ companies: Company[]; graph: Graph }> {
  const companies = await getCompanies();
  return { companies, graph: buildGraph(companies) };
}

export async function loadAll(): Promise<{
  companies: Company[];
  deals: Deal[];
  taxonomy: Taxonomy;
  graph: Graph;
}> {
  const [companies, deals, taxonomy] = await Promise.all([getCompanies(), getDeals(), getTaxonomy()]);
  return { companies, deals, taxonomy, graph: buildGraph(companies) };
}

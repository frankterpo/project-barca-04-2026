import { z } from "zod";

const entityTypeEnum = z.string();

export type CalaEntityType = string;

const entityMentionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  entity_type: entityTypeEnum,
  mentions: z.array(z.string()),
});

export type CalaEntityMention = z.infer<typeof entityMentionSchema>;

const documentSchema = z.object({
  name: z.string(),
  url: z.string(),
});

const explainabilityItemSchema = z.object({
  text: z.string().optional(),
  documents: z.array(documentSchema).optional(),
}).passthrough();

// POST /v1/knowledge/search
export const searchResponseSchema = z.object({
  answer: z.string().optional(),
  explainability: z.array(explainabilityItemSchema).optional(),
  entities: z.array(entityMentionSchema).optional(),
  documents: z.array(documentSchema).optional(),
}).passthrough();

export type CalaSearchResponse = z.infer<typeof searchResponseSchema>;

// POST /v1/knowledge/query
export const queryResponseSchema = z.object({
  results: z.array(z.record(z.unknown())),
  entities: z.array(entityMentionSchema),
});

export type CalaQueryResponse = z.infer<typeof queryResponseSchema>;

// GET /v1/entities (search by name)
const entitySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  entity_type: entityTypeEnum,
  description: z.string().nullish(),
});

export type CalaEntity = z.infer<typeof entitySchema>;

export const entitySearchResponseSchema = z.object({
  entities: z.array(entitySchema),
});

export type CalaEntitySearchResponse = z.infer<typeof entitySearchResponseSchema>;

// POST /v1/entities/{entity_id} — profile is deeply nested and varies per entity
export const entityProfileResponseSchema = z.record(z.unknown());
export type CalaEntityProfile = Record<string, unknown>;

// GET /v1/entities/{entity_id}/introspection
export const introspectionResponseSchema = z.record(z.unknown());
export type CalaIntrospection = Record<string, unknown>;

import { describe, it, expect } from 'vitest';
import { buildUserPrompt } from './engine/llmMessaging';

describe('LLM prompt', () => {
  it('gives risk with its usual and names the change separately, without percentages', () => {
    const prompt = buildUserPrompt({
      residentProfile: { name: 'Walter', age: 88, mobilityBaseline: 42, cognitiveConcernLevel: 'Low' },
      riskScores: { fall: 84, cognitive: 5, loneliness: 0, overall: 84 },
      standingScores: { fall: 90, cognitive: 20, loneliness: 30, overall: 90 },
      usualScores: { fall: 77, cognitive: 18, loneliness: 30, overall: 77 },
      timeOfDay: 3, interventionLevel: 4, topContributingFactors: ['Mobility stability'], staffLoad: 40, useWearables: false,
    });
    expect(prompt).toContain('Fall risk: 90 (usual 77)');
    expect(prompt).toMatch(/change from usual: High/i);
    expect(prompt).not.toMatch(/\d%/);
  });
});

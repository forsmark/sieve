# Matching evaluation

Date: 2026-11-11. This document records one run of the real matching pipeline on real postings.

## Setup

- 20 postings fetched live with the search term "developer": 6 from Jobindex, 6 from Arbeitnow, 5 from Remote OK, 3 from Remotive. Each has a description of 200 characters or more.
- Duplicate detection joined 2 of the 20 postings with an earlier posting, so 18 postings entered the match queue.
- Provider: Claude Code 2.1.322 with `claude-haiku-5-5`, once at low effort and once at medium effort. Each run used an empty database.
- Profile: a synthetic senior frontend developer. Expert TypeScript and React, strong Node.js and CSS, 9 years, English and Danish. No real CV was used.
- Preferences: location Copenhagen (soft), target seniority senior, wanted TypeScript and React, unwanted PHP, default weights 40 / 25 / 20 / 15.
- The local endpoint provider has its own run below, with Gemma 4 E4B on Lemonade Server.

## Result

| | Low effort | Medium effort |
| --- | --- | --- |
| Postings scored | 18 of 18 | 18 of 18 |
| Failed or retried calls | 0 | 0 |
| Extract call | 7.1 s average, 9.0 s longest | 8.3 s average, 11.2 s longest |
| Judge call | 5.9 s average, 6.8 s longest | 7.1 s average, 10.8 s longest |
| Whole run, 36 calls in sequence | 234 s | 277 s |

Scores are skills / experience / preferences / location = total. Time is extract plus judge for the posting, in seconds.

| # | Source | Title | Company | Chars | Low effort | s | Medium effort | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | arbeitnow | Full-Stack Engineer - ElevenAPI | ElevenLabs | 5312 | 70 / 78 / 88 / 100 = **80** | 11.9 | 60 / 65 / 85 / 100 = **72** | 16.2 |
| 2 | jobindex | Senior Developer to support the Green Energy Transition | Nordic RCC | 340 | 55 / 85 / 70 / 100 = **72** | 11.9 | 55 / 85 / 72 / 100 = **73** | 12.7 |
| 3 | remotive | Full-Stack Developer | Fluence International, Inc. | 7311 | 30 / 85 / 85 / 100 = **65** | 13.0 | 30 / 85 / 85 / 100 = **65** | 14.5 |
| 4 | remoteok | Senior Vue Developer | Lemon.io | 4958 | 35 / 75 / 65 / 100 = **61** | 14.6 | 20 / 72 / 62 / 100 = **53** | 14.8 |
| 5 | remoteok | Software Engineer | Claims | 8306 | 35 / 45 / 72 / 100 = **55** | 14.4 | 38 / 55 / 74 / 100 = **59** | 19.8 |
| 6 | arbeitnow | Senior Frontend Engineer | Almedia | 3451 | 40 / 80 / 85 / 0 = **53** | 12.0 | 35 / 80 / 85 / 0 = **51** | 16.5 |
| 7 | remoteok | UI Developer | RainFocus | 4118 | 35 / 40 / 25 / 100 = **44** | 14.4 | 30 / 35 / 20 / 100 = **40** | 13.7 |
| 8 | remoteok | Front End Developer | Cambridge Information Group | 5486 | 25 / 55 / 20 / 100 = **43** | 14.1 | 20 / 45 / 15 / 100 = **37** | 19.1 |
| 9 | remoteok | AI Developer | Salvo Software | 3720 | 12 / 25 / 55 / 100 = **37** | 14.0 | 10 / 30 / 50 / 100 = **37** | 18.0 |
| 10 | remotive | Senior Back-end Developer | Lemon.io | 3866 | 12 / 22 / 50 / 100 = **35** | 13.5 | 12 / 22 / 40 / 100 = **33** | 14.9 |
| 11 | remotive | Head of Engineering | Lemon.io | 2803 | 15 / 25 / 40 / 100 = **35** | 12.0 | 15 / 25 / 45 / 100 = **36** | 13.7 |
| 12 | arbeitnow | GTM Enablement - Product | ElevenLabs | 7475 | 10 / 25 / 50 / 100 = **35** | 13.2 | 8 / 22 / 60 / 100 = **36** | 14.1 |
| 13 | jobindex | Senior Java Developer | KMD A/S | 356 | 6 / 35 / 55 / 70 = **33** | 11.6 | 5 / 40 / 50 / 0 = **22** | 13.8 |
| 14 | arbeitnow | Technical Product Manager (d/f/m) - People Intelligence Apps | Taxfix | 6395 | 12 / 35 / 60 / 0 = **26** | 15.2 | 15 / 25 / 40 / 0 = **20** | 19.5 |
| 15 | jobindex | Senior Clojure Developer | twoday A/S | 296 | 5 / 40 / 50 / 0 = **22** | 10.8 | 5 / 35 / 40 / 0 = **19** | 11.6 |
| 16 | jobindex | Global People & Culture Manager – Development | Scan Global Logistics | 252 | 10 / 10 / 50 / 0 = **17** | 12.2 | 3 / 10 / 40 / 0 = **12** | 15.4 |
| 17 | arbeitnow | Senior Product Management Builder (d/f/m) | Taxfix | 8166 | 5 / 15 / 45 / 0 = **15** | 11.9 | 8 / 12 / 60 / 0 = **18** | 14.9 |
| 18 | jobindex | Head of Group Legal | Collectia A/S | 386 | 8 / 5 / 30 / 0 = **10** | 13.0 | 2 / 5 / 40 / 0 = **10** | 14.0 |

## Score quality

These are observations from one run, read by the implementer. They are not a measured accuracy.

- The order is plausible for the profile. Full-stack and frontend roles with TypeScript or React are at the top. Legal, people, and product management roles are at the bottom with skills scores of 15 or less.
- The two effort levels agree closely. The total differs by 3.6 points on average and by 11 points at most. The same five postings are at the top in both runs, in a slightly different order.
- Medium effort took about 19 percent more time and did not give a visibly better order in this sample. Low effort is a reasonable default.
- No call returned output that failed the schema.
- Example assessment at low effort for the top posting: "You fit well on the core stack, with expert TypeScript and React, five years of Node.js, and nine years of senior-level web work. Your main gap is experimentation, which the profile does not show, and your background is weighted toward frontend rather than backend or API work."

## Weak points that this run showed

- **Jobindex descriptions are short.** The result card gives 250 to 390 characters. The extract step then finds few or no required skills, and the skills score rests on the title. The description fetch does not start, because the limit for a missing description is 200 characters. A higher limit for this source, or a fetch of the full posting page, would give better input.
- **Location match is by text.** "Nordhavn", "Brøndby", and "Hvidovre" are in or near Copenhagen, but they do not contain the text "Copenhagen", so the location score is 0. The user must add such places to the commutable locations. A fixed table of regions would remove this work.
- **Extracted location can differ between runs.** For "Senior Java Developer" at KMD, the low run found no location (score 70) and the medium run found one outside the accepted locations (score 0). This moved the total by 11 points, the largest difference in the sample.
- **Search terms decide the input.** The term "developer" matched unrelated roles on Jobindex and Arbeitnow, such as "Head of Group Legal". The scores handle this correctly, but each such posting costs two model calls.

## Local model: Gemma 4 E4B on Lemonade

Date: 2026-11-11. This run used the same 20 saved postings, the same profile, and the same preferences as the Claude Code runs above.

### Setup

- Server: Lemonade Server 2026.45.3 with its llama.cpp backend on Vulkan. An earlier run on version 2026.43.3 gave a similar result.
- Model: `unsloth/gemma-4-E4B-it-GGUF`, file `Q4_K_M`, about 5 GB. Lemonade lists it as `gemma-4-E4B-it-GGUF-Q4_K_M`.
- Hardware: AMD Radeon RX 9060 XT, AMD Ryzen 7 5800X, 30 GB of memory.
- Provider setting: local endpoint, base URL `http://localhost:13305/api/v1`.
- The model wrote reasoning text before each answer. The run did not turn this off.

### Result

| | Gemma 4 E4B | Haiku 5.5 low effort |
| --- | --- | --- |
| Postings scored | 18 of 18 | 18 of 18 |
| Failed or retried calls | 0 | 0 |
| Extract call | 10.2 s average, 15.9 s longest | 7.1 s average, 9.0 s longest |
| Judge call | 10.0 s average, 12.1 s longest | 5.9 s average, 6.8 s longest |
| Whole run, 36 calls in sequence | 364 s | 234 s |

The server accepted JSON schema output. No call used the JSON mode fallback, and no answer failed validation.

The rows are in the order of the Haiku low effort run. Time is extract plus judge, in seconds.

| # | Title | Company | Gemma 4 E4B | s | Haiku low | Haiku medium |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Full-Stack Engineer - ElevenAPI | ElevenLabs | 75 / 90 / 100 / 100 = **88** | 22.4 | 80 | 72 |
| 2 | Senior Developer to support the Green Energy Transition | Nordic RCC | 95 / 95 / 100 / 100 = **97** | 17.4 | 72 | 73 |
| 3 | Full-Stack Developer | Fluence International, Inc. | 60 / 80 / 90 / 100 = **77** | 22.9 | 65 | 65 |
| 4 | Senior Vue Developer | Lemon.io | 55 / 100 / 100 / 100 = **82** | 20.3 | 61 | 53 |
| 5 | Software Engineer | Claims | 65 / 80 / 90 / 100 = **79** | 25.2 | 55 | 59 |
| 6 | Senior Frontend Engineer | Almedia | 70 / 95 / 85 / 0 = **69** | 25.3 | 53 | 51 |
| 7 | UI Developer | RainFocus | 85 / 30 / 75 / 100 = **72** | 19.1 | 44 | 40 |
| 8 | Front End Developer | Cambridge Information Group | 45 / 95 / 75 / 100 = **72** | 23.1 | 43 | 37 |
| 9 | AI Developer | Salvo Software | 30 / 50 / 70 / 100 = **54** | 19.8 | 37 | 37 |
| 10 | Senior Back-end Developer | Lemon.io | 25 / 60 / 90 / 100 = **58** | 20.4 | 35 | 33 |
| 11 | Head of Engineering | Lemon.io | 40 / 60 / 100 / 100 = **66** | 18.2 | 35 | 36 |
| 12 | GTM Enablement - Product | ElevenLabs | 50 / 85 / 90 / 100 = **74** | 24.6 | 35 | 36 |
| 13 | Senior Java Developer | KMD A/S | 30 / 90 / 95 / 0 = **54** | 16.5 | 33 | 22 |
| 14 | Technical Product Manager (d/f/m) - People Intelligence Apps | Taxfix | 30 / 65 / 90 / 0 = **46** | 23.2 | 26 | 20 |
| 15 | Senior Clojure Developer | twoday A/S | 20 / 90 / 95 / 0 = **50** | 13.2 | 22 | 19 |
| 16 | Global People & Culture Manager – Development | Scan Global Logistics | 0 / 30 / 70 / 0 = **22** | 17.2 | 17 | 12 |
| 17 | Senior Product Management Builder (d/f/m) | Taxfix | 30 / 60 / 90 / 0 = **45** | 19.5 | 15 | 18 |
| 18 | Head of Group Legal | Collectia A/S | 0 / 0 / 70 / 0 = **14** | 15.4 | 10 | 10 |

### Observations

These are observations from one run, read by the implementer. They are not a measured accuracy.

- **The order agrees with Haiku.** The rank correlation with the Haiku low effort run is 0.92. The same five postings are at the top, in a slightly different order.
- **The scores are higher.** The total is 21.2 points above Haiku low effort on average and 39 points at most. The default threshold of 80 for a notification and the score bands were set with Haiku in mind. With this model, more postings pass them.
- **Experience and preference scores are generous.** "Senior Clojure Developer" got 90 for experience and 95 for preferences, and Haiku gave 40 and 50. The model rewards the matching seniority and does not lower the score for a different technology.
- **Short descriptions give wrong high scores.** "Senior Developer to support the Green Energy Transition" has a description of 340 characters that names no technology. The judge gave 95 for skills and listed every profile skill as matched, with no missing skill. This posting ranks first with 97. Haiku gave it 72.
- **Extraction is usable.** For postings with a full description, the required and optional skills match the text.

- **Two runs differ.** The run on version 2026.43.3 and this run gave totals that differ by 5.4 points on average and by 20 points at most, with the same input. The two Haiku runs differed by 3.6 on average.

A model of this size works for ranking. For score values that match the bands, use a larger local model or the Claude Code provider.

## Local model: Gemma 4 26B A4B on Lemonade

Date: 2026-11-11. This run used the same 20 saved postings, the same profile, and the same preferences as the runs above.

### Setup

- Server: Lemonade Server 2026.45.3 with its llama.cpp backend on Vulkan.
- Model: `unsloth/gemma-4-26B-A4B-it-GGUF`, file `UD-IQ4_XS`, 13.6 GB. Lemonade lists it as `gemma-4-26B-A4B-it-GGUF-UD-IQ4_XS`.
- Hardware: AMD Radeon RX 9060 XT with 16 GB, AMD Ryzen 7 5800X, 30 GB of memory. The desktop used about 2.2 GB of GPU memory before the model loaded.
- Load options, saved for this model in Lemonade:

```sh
lemonade load gemma-4-26B-A4B-it-GGUF-UD-IQ4_XS --ctx-size 16384 \
  --llamacpp-args "--fit on --fit-target 2560 --no-mmproj-offload --reasoning-budget 0" --save-options
```

- `--fit-target 2560` keeps 2.5 GB of GPU memory free and puts the rest of the model on the CPU. `--no-mmproj-offload` keeps the vision file on the CPU. `--reasoning-budget 0` turns reasoning off.

### Memory

| | Value |
| --- | --- |
| GPU memory in use with the model loaded | 14.0 of 16.3 GB |
| Highest GPU memory during the run | 14.0 GB |
| Lowest available system memory during the run | 11.4 GB |

### Reasoning must be off

With reasoning on, the run did not finish. In two attempts, a call passed the 180 second limit of the system, the system marked the provider as not available, and no posting got a score. The calls that did finish took 61 seconds on average for one extraction, with up to 2,000 tokens of reasoning. With reasoning off, every call finished in 10 seconds or less.

### Result with reasoning off

| | Gemma 4 26B A4B | Gemma 4 E4B | Haiku 5.5 low effort |
| --- | --- | --- | --- |
| Postings scored | 18 of 18 | 18 of 18 | 18 of 18 |
| Failed or retried calls | 0 | 0 | 0 |
| Extract call | 6.5 s average, 10.0 s longest | 10.2 s average | 7.1 s average |
| Judge call | 4.3 s average, 5.4 s longest | 10.0 s average | 5.9 s average |
| Whole run, 36 calls in sequence | 194 s | 364 s | 234 s |
| Total compared with Haiku low effort, average | 0.4 points higher | 21.2 points higher | |
| Absolute difference from Haiku low effort | 7.4 average, 20 at most | 21.2 average, 39 at most | |
| Rank correlation with Haiku low effort | 0.92 | 0.92 | |

The E4B run had reasoning on, so its times do not compare directly with the 26B times.

The rows are in the order of the Haiku low effort run. Time is extract plus judge, in seconds.

| # | Title | Company | Gemma 4 26B A4B | s | Haiku low | Haiku medium |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Full-Stack Engineer - ElevenAPI | ElevenLabs | 30 / 75 / 100 / 100 = **66** | 10.3 | 80 | 72 |
| 2 | Senior Developer to support the Green Energy Transition | Nordic RCC | 0 / 100 / 100 / 100 = **60** | 7.2 | 72 | 73 |
| 3 | Full-Stack Developer | Fluence International, Inc. | 40 / 75 / 100 / 100 = **70** | 13.7 | 65 | 65 |
| 4 | Senior Vue Developer | Lemon.io | 10 / 85 / 40 / 100 = **48** | 11.7 | 61 | 53 |
| 5 | Software Engineer | Claims | 60 / 75 / 85 / 100 = **75** | 14.9 | 55 | 59 |
| 6 | Senior Frontend Engineer | Almedia | 60 / 100 / 85 / 0 = **66** | 12.1 | 53 | 51 |
| 7 | UI Developer | RainFocus | 20 / 40 / 30 / 100 = **39** | 10.6 | 44 | 40 |
| 8 | Front End Developer | Cambridge Information Group | 20 / 60 / 30 / 100 = **44** | 13.5 | 43 | 37 |
| 9 | AI Developer | Salvo Software | 15 / 20 / 30 / 100 = **32** | 12.8 | 37 | 37 |
| 10 | Senior Back-end Developer | Lemon.io | 15 / 30 / 70 / 100 = **43** | 9.7 | 35 | 33 |
| 11 | Head of Engineering | Lemon.io | 0 / 40 / 70 / 100 = **39** | 9.9 | 35 | 36 |
| 12 | GTM Enablement - Product | ElevenLabs | 10 / 20 / 70 / 100 = **38** | 14.2 | 35 | 36 |
| 13 | Senior Java Developer | KMD A/S | 0 / 40 / 70 / 0 = **24** | 6.4 | 33 | 22 |
| 14 | Technical Product Manager (d/f/m) - People Intelligence Apps | Taxfix | 10 / 40 / 50 / 0 = **24** | 13.0 | 26 | 20 |
| 15 | Senior Clojure Developer | twoday A/S | 0 / 40 / 70 / 0 = **24** | 6.9 | 22 | 19 |
| 16 | Global People & Culture Manager – Development | Scan Global Logistics | 0 / 0 / 70 / 0 = **14** | 7.8 | 17 | 12 |
| 17 | Senior Product Management Builder (d/f/m) | Taxfix | 10 / 30 / 70 / 0 = **26** | 12.4 | 15 | 18 |
| 18 | Head of Group Legal | Collectia A/S | 0 / 0 / 70 / 0 = **14** | 6.6 | 10 | 10 |

### Observations

These are observations from one run, read by the implementer. They are not a measured accuracy.

- **The score values are close to Haiku.** The average total is within one point of Haiku low effort. The score bands and the notification threshold of 80 need no change for this model.
- **It is the fastest of the runs.** One posting takes 10.8 seconds on average, and Haiku low effort takes 13.0.
- **It handles the short posting correctly.** "Senior Developer to support the Green Energy Transition" names no technology. This model gave 0 for skills and a total of 60. Gemma 4 E4B gave 95 and 97.
- **A different technology lowers the score.** "Senior Clojure Developer" got 0 for skills with "Clojure" as the missing skill, and a total of 24. Haiku gave 22.
- **Preference scores are coarse.** Seven postings got exactly 70 for preferences, and three got 100. Haiku spreads these values more.
- **The order of the top five differs.** "Software Engineer" at Claims ranks first with 75, and Haiku ranks it fifth with 55. The assessment for it names the basic Python level as a risk, so the high total does not follow from the text.
- Example assessment for that posting: "You have strong expertise in the required frontend technologies like TypeScript and React, which aligns well with the web dashboard aspect of the role. However, your Python skills are currently at a basic level, which may make it challenging to manage the backend services and data pipelines required for this position."

This model with reasoning off is a usable local replacement for the Claude Code provider on this machine.

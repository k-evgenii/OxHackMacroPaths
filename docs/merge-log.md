| agent | sha | build | tests | reviewer |
| --- | --- | --- | --- | --- |
| 02-math | 1355c2d | build 3s | 11 passing | orchestrator |
| 03-chain | c020011 | build 7s | 12 passing | orchestrator |
| 03-chain-v2 | da58987 | build 2s | 12 passing | re-merged as v2 after the main chain commit 6bf12ac; the first 03 merge had the wrong dataset_id, and main's chain (PR #6) is authoritative |
| 01-skeleton | 09ae224 | build 7s | 12 passing | orchestrator |
| 01-fixtures | 751efce | build 4s | 13 passing | orchestrator |
| 04-create-session | d817f24 | build 8s | 19 passing | orchestrator |
| 06-lock-expire | 1f15b12 | build 4s | 27 passing | orchestrator |
| 05-deposit | 54b33f2 | build 6s | 36 passing | orchestrator |
| 07-observe | 2cf0166 | build 33s | 48 passing | orchestrator |
| 08-settle | f319ac7 | build 34s | 53 passing | orchestrator |
| 09-claim-sweep | e70ac16 | build 33s | 64 passing | orchestrator |
| 01b-upgrade-room | 20667a9 | build 5s | 64 passing | orchestrator |
| 11-security | 9c602a0 | build 68s | 80 passing | orchestrator |
| 01c-seller-fixtures | f872a5a | build 4s | 82 passing | orchestrator |
| 10-lifecycle | dac2531 | build 6s | 84 passing | orchestrator |
| 12-seller-accounts | 592d98a | build 2s | 100 passing | orchestrator |
| 13-cover | aff3e1f | build 11s | 113 passing | orchestrator |
| 14-keeper-bridge | c7c98b3 | build 8s | 113 passing | orchestrator |
| deploy-g2 | dab88ff | Phill binary d198a8c3fc792519ab0db4829007e2451c51d6783fb6c7225b353dd639f658e2 | 117 passing | gate G2 pass on d198a8c3. lifecycle_one_product and lifecycle_full passed on that binary at dab88ff43ed988a112b192702b474db8f2cbcdc7. Deployed bytes verified identical on devnet: program FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS, 487344 bytes, upgrade authority DwZ3j9GQZZTegHocho27JQfY7HZfCt8HNRceqe2hrJLV |

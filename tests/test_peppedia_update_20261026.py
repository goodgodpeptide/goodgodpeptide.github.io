import hashlib, json, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class PepPediaUpdateAuditTest(unittest.TestCase):
 def setUp(self):
  self.db=json.loads((ROOT/'peptides_v3.json').read_text(encoding='utf-8'))
  self.manifest=json.loads((ROOT/'audit/peppedia_update_20261026/manifest.json').read_text(encoding='utf-8'))
  self.raw=ROOT/self.manifest['source']['snapshotPath']
  self.api=json.loads(self.raw.read_text(encoding='utf-8')) if self.raw.exists() else None
 def test_database_integrity_and_source_urls(self):
  self.assertEqual(self.db['totalCount'],115)
  self.assertEqual(len(self.db['index']),115)
  self.assertEqual(len(self.db['peptides']),115)
  self.assertEqual({x['id'] for x in self.db['index']},set(self.db['peptides']))
  for slug,item in self.db['peptides'].items():
   self.assertEqual(item['id'],slug)
   self.assertTrue(item['sourceUrl'].startswith('https://'), (slug,item['sourceUrl']))
 def test_snapshot_identity_and_full_slug_comparison(self):
  if self.api is None: self.skipTest('Pep-Pedia raw audit snapshot is intentionally not committed')
  self.assertEqual(hashlib.sha256(self.raw.read_bytes()).hexdigest(),self.manifest['source']['snapshotSha256'])
  api_slugs={x['slug'] for x in self.api['peptides']}; local_slugs=set(self.db['peptides'])
  c=self.manifest['comparison']
  self.assertEqual(c['apiCount'],len(api_slugs)); self.assertEqual(c['localCountAfter'],len(local_slugs))
  self.assertEqual(c['apiOnlyAfter'],sorted(api_slugs-local_slugs)); self.assertEqual(c['localOnlyPreserved'],sorted(local_slugs-api_slugs))
 def test_epitalon_does_not_present_unestablished_sc_regimen(self):
  x=self.db['peptides']['epitalon']; joined=json.dumps({'dose':x['typicalDose'],'frequency':x['frequency'],'quickStart':x['quickStart'],'protocols':x['protocols']},ensure_ascii=False)
  self.assertIn('사람 피하 표준용량 미확립',joined)
  self.assertEqual(x['protocols'],[])
  self.assertNotIn('10mg/day',joined); self.assertNotIn('200-500μg per injection',joined)
  self.assertEqual(x['cycle'],'Not established'); self.assertEqual(x['effectsTimeline'],[])
  self.assertIn('No clinical benefit has been established',x['keyBenefits'])
  self.assertFalse(x['evidenceReview']['subcutaneousHumanDoseEstablished'])
  self.assertTrue(x['evidenceReview']['animalDoseIsNotHumanDose'])
  self.assertFalse(x['evidenceReview']['sourceReportedDose']['publishedAsRecommendation'])
 def test_epitalon_evidence_separates_route_population_and_safety(self):
  x=self.db['peptides']['epitalon']; ev=x['evidenceReview']['humanEvidence']
  self.assertEqual(ev['route'],'Sublingual'); self.assertEqual(ev['participantsTotal'],75); self.assertEqual(ev['epitalonParticipants'],20)
  self.assertFalse(ev['sleepOutcomeEvaluated']); self.assertFalse(ev['safetyDataReported'])
  self.assertIn('epithalamin',x['evidenceReview']['distinctSubstanceWarning'])
  self.assertEqual(x['latestResearch'][0]['link'],'https://www.fda.gov/media/193774/download')
 def test_five_new_items_are_research_cards_without_human_regimens(self):
  expected={'aicar','cortagen','klotho','ptd-dbm','slu-pp-915'}
  self.assertEqual(set(self.manifest['comparison']['apiOnlyBefore']),expected)
  self.assertTrue(expected.issubset(self.db['peptides']))
  for slug in expected:
   x=self.db['peptides'][slug]
   self.assertEqual(x['typicalDose'],'사람 표준용량 미확립')
   self.assertEqual(x['protocols'],[])
   self.assertFalse(x['evidenceReview']['humanStandardDoseEstablished'])
   self.assertFalse(x['evidenceReview']['selfAdministrationScheduleProvided'])
   self.assertTrue(x['evidenceReview']['primaryReferences'])
  self.assertIn('Non-peptide',self.db['peptides']['aicar']['evidenceReview']['substanceType'])
  self.assertIn('Non-peptide',self.db['peptides']['slu-pp-915']['evidenceReview']['substanceType'])
  self.assertIn('protein',self.db['peptides']['klotho']['evidenceReview']['substanceType'].lower())
 def test_status_enums_regulatory_corrections_and_updates(self):
  allowed={'Limited Research','Emerging Research','Clinical Research','Well Researched','Extensively Studied'}
  for slug in ['aicar','cortagen','klotho','ptd-dbm','slu-pp-915','epitalon']:
   self.assertIn(self.db['peptides'][slug]['researchStatus'],allowed)
  self.assertEqual(self.db['peptides']['epitalon']['researchStatus'],'Limited Research')
  index={x['id']:x for x in self.db['index']}
  for slug in ['ghk-cu','mazdutide','sermorelin']:
   self.assertFalse(self.db['peptides'][slug]['isApproved']); self.assertFalse(index[slug]['isApproved'])
   self.assertTrue(self.db['peptides'][slug]['evidenceReview']['regulatoryStatus']['source'].startswith('https://'))
  aicar=json.dumps(self.db['peptides']['aicar']['evidenceReview'],ensure_ascii=False)
  self.assertIn('3,080',aicar); self.assertIn('did not improve',aicar)
  self.assertEqual(self.db['peptides']['retatrutide']['latestResearch'][0]['source'],'Eli Lilly investor news release')
  self.assertIn('investigational',self.db['peptides']['retatrutide']['latestResearch'][0]['excerpt'])
  self.assertEqual(self.db['peptides']['orforglipron']['latestResearch'][0]['source'],'U.S. Food and Drug Administration')
if __name__=='__main__': unittest.main()

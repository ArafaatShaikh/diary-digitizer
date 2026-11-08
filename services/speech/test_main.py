import os
import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
import main

class FakeAuth:
    def __init__(self, **kwargs): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def get(self, *args, **kwargs):
        class User: status_code = 200
        return User()

class SpeechServiceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.payload = {'text': 'A quiet evening.', 'voice': 'en-GB-SoniaNeural'}
        self.headers = {'Authorization': 'Bearer fictional-test-token'}
        self.env = patch.dict(os.environ, {'NEXT_PUBLIC_SUPABASE_URL': 'https://example.invalid', 'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'test-anon'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_missing_session_never_generates_audio(self):
        with patch.object(main, 'synthesise', new_callable=AsyncMock) as speak:
            self.assertEqual(self.client.post('/synthesise', json=self.payload).status_code, 401)
            speak.assert_not_called()

    def test_voice_and_length_validation_precede_generation(self):
        with patch.object(main.httpx, 'AsyncClient', FakeAuth), patch.object(main, 'synthesise', new_callable=AsyncMock) as speak:
            for payload in ({'text': 'hello', 'voice': 'unapproved'}, {'text': 'x'*801, 'voice': 'en-GB-SoniaNeural'}, {'text': '', 'voice': 'en-GB-SoniaNeural'}):
                self.assertEqual(self.client.post('/synthesise', headers=self.headers, json=payload).status_code, 400)
            self.assertEqual(self.client.post('/synthesise', headers=self.headers, content=b'x'*12001).status_code, 413)
            speak.assert_not_called()

    def test_success_is_private_mp3_using_sonia(self):
        with patch.object(main.httpx, 'AsyncClient', FakeAuth), patch.object(main, 'synthesise', new_callable=AsyncMock, return_value=b'ID3 audio') as speak:
            response = self.client.post('/synthesise', headers=self.headers, json=self.payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['content-type'], 'audio/mpeg')
            self.assertEqual(response.headers['cache-control'], 'no-store')
            speak.assert_awaited_once_with('A quiet evening.', 'en-GB-SoniaNeural')

    def test_provider_failure_stops_without_retry(self):
        with patch.object(main.httpx, 'AsyncClient', FakeAuth), patch.object(main, 'synthesise', new_callable=AsyncMock, side_effect=RuntimeError('private provider detail')) as speak:
            response = self.client.post('/synthesise', headers=self.headers, json=self.payload)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('private provider detail', response.text)
            self.assertEqual(speak.await_count, 1)

if __name__ == '__main__': unittest.main()

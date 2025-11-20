from abc import ABC, abstractmethod
import time
import random

class TranslationProvider(ABC):
    @abstractmethod
    def translate(self, text: str, target_lang: str, source_lang: str = "auto") -> str:
        """
        Translate text from source_lang to target_lang.
        """
        pass

class DummyTranslationProvider(TranslationProvider):
    def translate(self, text: str, target_lang: str, source_lang: str = "auto") -> str:
        """
        Dummy implementation that prefixes the text.
        """
        # Simulate some latency
        time.sleep(0.1)
        return f"[Translated to {target_lang}]: {text}"

def get_translation_provider() -> TranslationProvider:
    # In the future, this can read from env to choose provider
    return DummyTranslationProvider()

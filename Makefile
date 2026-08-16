.PHONY: run test check

run:
	python server.py

test:
	python -m unittest discover -s tests -v

check: test
	python -m py_compile server.py ict_engine.py

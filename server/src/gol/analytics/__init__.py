"""Pure spending-analytics functions (v1.2, T-007).

No ORM, no clock, no I/O in this package: every function takes plain data
(dataclasses / primitives) and `today` where time matters, so QA can
property-test detection without a database.
"""
